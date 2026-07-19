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

import type { DocumentPath } from '../errors.js'
import type { CurveSide, Event, Note, Pitch } from '../model/score.js'
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

/** Ties match on pitch within a voice, so that is what keys them. */
function tieKey(voice: string | undefined, pitch: Pitch): string {
  return `${voice ?? ''}|${pitch.step}${String(pitch.octave)}|${String(pitch.alter)}`
}

/**
 * Slurs match on the number the source gives them, within a voice.
 *
 * MusicXML does not say the number is scoped to a voice, and a slur may
 * genuinely run from one voice into another. Scoping it anyway is the safer
 * reading, because exporters routinely start every voice's slurs at number 1,
 * and a part-wide scope would then join one voice's slur to another's. Tried
 * both ways against the vendored songs: they resolve identically.
 */
function slurKey(voice: string | undefined, number: string): string {
  return `${voice ?? ''}|${number}`
}

export class SpannerResolver {
  readonly #openTies = new Map<string, OpenTie>()
  readonly #openSlurs = new Map<string, OpenSlur>()

  startTie(note: Note, voice: string | undefined, context: WarningContext): void {
    this.#openTies.set(tieKey(voice, note.pitch), { note, context })
  }

  /** Joins the tie waiting on this pitch, if one is. */
  stopTie(
    note: Note,
    voice: string | undefined,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    const key = tieKey(voice, note.pitch)
    const open = this.#openTies.get(key)
    if (!open) {
      warnings.add(
        'unclosed:spanner',
        'A tie ends on a note where none had started, and is not carried over.',
        context,
      )
      return
    }

    open.note.ties = [...open.note.ties, { target: note.id }]
    this.#openTies.delete(key)
  }

  startSlur(
    event: Event,
    voice: string | undefined,
    number: string,
    side: CurveSide | undefined,
    context: WarningContext,
  ): void {
    this.#openSlurs.set(slurKey(voice, number), { event, side, context })
  }

  stopSlur(
    event: Event,
    voice: string | undefined,
    number: string,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    const key = slurKey(voice, number)
    const open = this.#openSlurs.get(key)
    if (!open) {
      warnings.add(
        'unclosed:spanner',
        'A slur ends where none had started, and is not carried over.',
        context,
      )
      return
    }

    open.event.slurs = [...open.event.slurs, { target: event.id, side: open.side }]
    this.#openSlurs.delete(key)
  }

  /**
   * Reports whatever is still open once the part is read. Real scores do
   * contain these, so they are worth saying rather than worth refusing.
   */
  reportUnclosed(warnings: WarningCollector, _path: DocumentPath): void {
    for (const open of this.#openTies.values()) {
      warnings.add(
        'unclosed:spanner',
        'A tie starts on a note that nothing ties to, and is not carried over.',
        open.context,
      )
    }
    for (const open of this.#openSlurs.values()) {
      warnings.add(
        'unclosed:spanner',
        'A slur starts where nothing ends it, and is not carried over.',
        open.context,
      )
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
