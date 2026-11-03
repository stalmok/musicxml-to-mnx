// Where the events of a measure begin, for the end of a span to find the event
// it covers.

import { compareFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'

/**
 * The event a span ends on: where it begins in the measure, and, where grace
 * notes sit there, which one of them it is. The index counts back from the
 * note the grace notes ornament, which is 0, so the rightmost grace note is
 * 1. Unset where nothing at that place is a grace note.
 */
export interface CoveredEvent {
  start: Fraction
  graceIndex?: number
}

/** How many grace notes stand at a point, on the staff given or any. */
export type GraceNotesAt = (position: Fraction, staff?: number) => number

/** What the end of a span asks of the events of its measure. */
export interface EventTimeline {
  /** The last event of the measure before a point, on the staff given or any. */
  lastEventBefore(position: Fraction, staff?: number): CoveredEvent | undefined
  /** The last event of the measure on each staff that has one. */
  lastEvents(): ReadonlyMap<number, CoveredEvent>
  graceNotesAt: GraceNotesAt
}

/**
 * Where each event of a measure begins, whatever voice it is in, the staff it
 * was placed on, and whether it is a grace note. An event states no staff
 * where the part has only one, which is the first staff.
 */
export class MeasureTimeline implements EventTimeline {
  readonly #starts: { start: Fraction; staff: number | undefined; grace: boolean }[] = []

  add(start: Fraction, staff: number | undefined, grace: boolean): void {
    this.#starts.push({ start, staff, grace })
  }

  /**
   * Where the last event before this point begins. MNX states the end of an
   * octave shift as the place of the last event it covers, while MusicXML
   * writes the stop after that event, with the cursor already past it. Asked
   * once the measure is whole, so every event of it is counted whatever
   * order the source wrote them in.
   *
   * A staff narrows it to that staff's own events, because a shift belongs to
   * one staff and the other hand's notes lie under the same beats without
   * being what it covers. An event that names no staff is the first staff,
   * which is how MusicXML reads a note that leaves it off.
   */
  lastEventBefore(position: Fraction, staff?: number): CoveredEvent | undefined {
    return this.#lastBefore(position, staff)
  }

  /** The last event of the measure on each staff, grace notes after it included. */
  lastEvents(): Map<number, CoveredEvent> {
    const lastOn = new Map<number, CoveredEvent>()
    for (const staff of new Set(this.#starts.map((event) => event.staff ?? 1))) {
      const last = this.#lastBefore(undefined, staff)
      if (last) lastOn.set(staff, last)
    }
    return lastOn
  }

  /**
   * How many grace notes stand at a point, on a staff or across them all.
   * Asked twice about a span's stop: at the cursor while the measure is being
   * read, which counts the grace notes written before the stop, and again
   * once the measure is whole, which counts them all. MNX numbers a grace
   * note back from the note it ornaments, so the two counts together say
   * which one the stop was written after.
   *
   * A staff narrows it to that staff's own events, as an octave shift's end
   * does, so grace notes under the other hand do not answer for this one.
   */
  graceNotesAt(position: Fraction, staff?: number): number {
    return this.#starts.filter(
      (event) =>
        event.grace &&
        (staff === undefined || (event.staff ?? 1) === staff) &&
        compareFractions(event.start, position) === 0,
    ).length
  }

  /** The same as lastEventBefore, where no point asks for the last event of the measure. */
  #lastBefore(position: Fraction | undefined, staff?: number): CoveredEvent | undefined {
    let latest: Fraction | undefined
    for (const event of this.#starts) {
      if (staff !== undefined && (event.staff ?? 1) !== staff) continue
      if (position !== undefined && compareFractions(event.start, position) >= 0) continue
      if (!latest || compareFractions(event.start, latest) > 0) latest = event.start
    }
    if (!latest) return undefined

    const here = this.#starts.filter(
      (event) =>
        (staff === undefined || (event.staff ?? 1) === staff) &&
        compareFractions(event.start, latest) === 0,
    )
    // Grace notes share the place of the note they ornament, so the last
    // event here is that note where the source wrote one and the rightmost
    // grace note where it did not.
    if (!here.some((event) => event.grace)) return { start: latest }
    return { start: latest, graceIndex: here.some((event) => !event.grace) ? 0 : 1 }
  }
}
