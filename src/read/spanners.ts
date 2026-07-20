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

import type { Fraction } from '../fraction.js'
import type { CurveSide, Dynamic, Event, Note, Pitch } from '../model/score.js'
import type { WarningCollector, WarningContext } from '../warnings.js'

interface OpenTie {
  note: Note
  context: WarningContext
}

interface OpenSlur {
  event: Event
  side: CurveSide | undefined
  context: WarningContext
}

interface OpenWedge {
  dynamic: Dynamic
  context: WarningContext
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
  // The same, for hairpins, which the source numbers the same way.
  readonly #openWedges = new Map<string, OpenWedge[]>()

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

  /**
   * Starts a hairpin. Like a slur it is matched on the number the source
   * gives it, and several may carry the same number at once, so each number
   * holds a stack and a stop closes the most recently opened.
   */
  startWedge(dynamic: Dynamic, number: string, context: WarningContext): void {
    const waiting = this.#openWedges.get(number) ?? []
    waiting.push({ dynamic, context })
    this.#openWedges.set(number, waiting)
  }

  /** Fills in where the hairpin waiting on this number stops, if one is. */
  stopWedge(
    measure: number,
    position: Fraction,
    number: string,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    const open = this.#openWedges.get(number)?.pop()
    if (!open) {
      warnings.add(
        'unclosed:spanner',
        'A hairpin stops where none had started, and is not carried over.',
        context,
        'wedge',
      )
      return
    }

    open.dynamic.end = { measure, position }
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
    // A hairpin that nothing closes is still written, without an end: MNX
    // allows that, and it says more than dropping the mark would. What it
    // does not say is how far the hairpin runs, so it is reported.
    for (const waiting of this.#openWedges.values()) {
      for (const open of waiting) {
        warnings.add(
          'unclosed:spanner',
          'A hairpin starts where nothing ends it, so how far it runs is not carried over.',
          open.context,
          'wedge',
        )
      }
    }

    this.#openTies.clear()
    this.#openSlurs.clear()
    this.#openWedges.clear()
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
