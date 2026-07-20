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
  Note,
  Ottava,
  OttavaAmount,
  Pitch,
} from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'

interface OpenTie {
  note: Note
  context: WarningContext
}

/** An octave shift that has begun, waiting to learn where it stops. */
export interface OpenOttava {
  measure: number
  position: Fraction
  value: OttavaAmount
  staff: number | undefined
}

interface OpenSlur {
  event: Event
  side: CurveSide | undefined
  context: WarningContext
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
  position: Fraction
  /** Carried on a start, and handed back when its stop is found. */
  payload: T | undefined
  context: WarningContext
}

/**
 * Joins each span's two ends, in the order the music has them: by measure,
 * then by where in the measure the cursor had reached, with a stop before a
 * start at the same point so one span can finish exactly where the next
 * begins. Ends falling at the same point keep the order they were read in.
 *
 * Several may carry the same number at once, so each number holds a stack and
 * a stop closes the most recently opened.
 */
export function pairSpans<T>(
  ends: readonly SpanEnd<T>[],
  join: (payload: T, stop: SpanEnd<T>) => void,
  report: (reason: 'orphan-stop' | 'unclosed-start', end: SpanEnd<T>) => void,
): void {
  const open = new Map<string, SpanEnd<T>[]>()

  for (const end of inTimeOrder(ends)) {
    if (end.kind === 'start') {
      open.set(end.number, [...(open.get(end.number) ?? []), end])
      continue
    }

    const started = open.get(end.number)?.pop()
    if (!started) {
      report('orphan-stop', end)
      continue
    }
    /* v8 ignore next 2 -- only a start carries a payload, and only a start is
       ever pushed onto the stack this came off. */
    if (started.payload === undefined) throw new Error('A span start with nothing to join.')

    join(started.payload, end)
  }

  for (const waiting of open.values()) {
    for (const start of waiting) report('unclosed-start', start)
  }
}

function inTimeOrder<T>(ends: readonly SpanEnd<T>[]): SpanEnd<T>[] {
  return ends
    .map((end, index) => ({ end, index }))
    .sort((a, b) => {
      if (a.end.measure !== b.end.measure) return a.end.measure - b.end.measure
      const byPosition = compareFractions(a.end.position, b.end.position)
      if (byPosition !== 0) return byPosition
      if (a.end.kind !== b.end.kind) return a.end.kind === 'stop' ? -1 : 1
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
  readonly #openTies = new Map<string, OpenTie>()
  // Several slurs may carry the same number at once, so each number holds a
  // stack: a stop closes the most recently opened of them.
  readonly #openSlurs = new Map<string, OpenSlur[]>()
  // Both ends of every hairpin in the part, paired once all of them are in.
  readonly #wedgeEnds: SpanEnd<Dynamic>[] = []

  startTie(note: Note, context: WarningContext): void {
    this.#openTies.set(tieKey(note.pitch), { note, context })
  }

  /** Joins the tie waiting on this pitch, if one is. */
  stopTie(note: Note, warnings: WarningCollector, context: WarningContext): void {
    const key = tieKey(note.pitch)
    const open = this.#openTies.get(key)
    if (!open) {
      warnings.add(
        'unclosed:spanner',
        'A tie ends on a note where none had started, and is not carried over.',
        context,
        'tie',
      )
      return
    }

    open.note.ties = [...open.note.ties, { target: note.id }]
    this.#openTies.delete(key)
  }

  startSlur(
    event: Event,
    number: string,
    side: CurveSide | undefined,
    context: WarningContext,
  ): void {
    const waiting = this.#openSlurs.get(number) ?? []
    waiting.push({ event, side, context })
    this.#openSlurs.set(number, waiting)
  }

  stopSlur(
    event: Event,
    number: string,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    const open = this.#openSlurs.get(number)?.pop()
    if (!open) {
      warnings.add(
        'unclosed:spanner',
        'A slur ends where none had started, and is not carried over.',
        context,
        'slur',
      )
      return
    }

    open.event.slurs = [...open.event.slurs, { target: event.id, side: open.side }]
  }

  /** Notes where a hairpin begins, to be paired once the part is read. */
  startWedge(
    dynamic: Dynamic,
    number: string,
    measure: number,
    position: Fraction,
    context: WarningContext,
  ): void {
    this.#wedgeEnds.push({ kind: 'start', number, measure, position, payload: dynamic, context })
  }

  /** The same, where one stops. */
  stopWedge(number: string, measure: number, position: Fraction, context: WarningContext): void {
    this.#wedgeEnds.push({ kind: 'stop', number, measure, position, payload: undefined, context })
  }

  /** Joins every hairpin in the part, once all of both ends are in. */
  resolveWedges(warnings: WarningCollector): void {
    pairSpans(
      this.#wedgeEnds,
      (dynamic, stop) => {
        dynamic.end = { measure: stop.measure, position: stop.position }
      },
      (reason, end) => {
        warnings.add(
          'unclosed:spanner',
          reason === 'orphan-stop'
            ? 'A hairpin stops where none had started, and is not carried over.'
            : // MNX allows a gradual mark with no end, so the mark is still
              // written; what is lost is how far it runs.
              'A hairpin starts where nothing ends it, so how far it runs is not carried over.',
          end.context,
          'wedge',
        )
      },
    )
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
    this.#ottavaEnds.push({ kind: 'start', number, measure, position, payload: open, context })
  }

  stopOttava(number: string, measure: number, position: Fraction, context: WarningContext): void {
    this.#ottavaEnds.push({ kind: 'stop', number, measure, position, payload: undefined, context })
  }

  /**
   * Joins every octave shift in the part, putting each finished one on the
   * measure it begins in. Unlike a hairpin, MNX requires a shift to say where
   * it stops, so one the source never closed cannot be written at all.
   */
  resolveOttavas(measures: readonly Ottava[][], warnings: WarningCollector): void {
    pairSpans(
      this.#ottavaEnds,
      (open, stop) => {
        measures[open.measure]?.push({
          position: open.position,
          end: { measure: stop.measure, position: stop.position },
          value: open.value,
          staff: open.staff,
        })
      },
      (reason, end) => {
        warnings.add(
          'unclosed:spanner',
          reason === 'orphan-stop'
            ? 'An octave shift stops where none had started, and is not carried over.'
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
  reportUnclosed(warnings: WarningCollector): void {
    for (const open of this.#openTies.values()) {
      warnings.add(
        'unclosed:spanner',
        'A tie starts on a note that nothing ties to, and is not carried over.',
        open.context,
        'tie',
      )
    }
    for (const waiting of this.#openSlurs.values()) {
      for (const open of waiting) {
        warnings.add(
          'unclosed:spanner',
          'A slur starts where nothing ends it, and is not carried over.',
          open.context,
          'slur',
        )
      }
    }
    this.#openTies.clear()
    this.#openSlurs.clear()
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
