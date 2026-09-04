// What the readers of one part share: the running state a measure cannot be
// read without.

import type { ClefSign, InstrumentSound, KitComponent } from '../model/score.js'
import { IdGenerator, SpannerResolver } from './spanners.js'

/** The clef in force on a staff: its sign and the line it sits on. */
export interface ClefInForce {
  sign: ClefSign
  line: number
}

/**
 * What a part carries from one measure to the next. `<divisions>` is stated
 * once and stays in force until restated, so a measure is not readable on its
 * own.
 */
export interface PartState {
  divisions: number | undefined
  /**
   * Whether the divisions in force are an assumption rather than something
   * the file stated. A written note value can be checked against an assumed
   * duration; a note with no written value cannot, so it is refused rather
   * than guessed at.
   */
  divisionsAssumed: boolean
  /**
   * The time signature in force, which like <divisions> stays until restated.
   * Held only so that a direction moved by an <offset> can be checked against
   * the length of the measure it lands in.
   */
  time: { count: number; unit: number } | undefined
  /** How many staves the part is written on, once it says. */
  staves: number
  /**
   * The clef in force on each staff, keyed by staff number and updated as
   * clefs are read in document order. A rest placed by <display-step> reads
   * its height against the clef on its staff.
   */
  clefs: Map<number, ClefInForce>
  /**
   * Which measure of the part is being read, counted from zero. Held because
   * a slur is written on a note and paired once the whole part is in, so each
   * end has to record where in the part it stands.
   */
  measure: number
  /** Shared across the score, so every id in the document is distinct. */
  ids: IdGenerator
  /** Per part: a tie or slur may span measures, but not parts. */
  spanners: SpannerResolver
  /**
   * The instrument setup the part list states, keyed as a note's <instrument>
   * names it. What a kit component takes its name and its sound from.
   */
  sounds: ReadonlyMap<string, InstrumentSound>
  /**
   * The percussion components this part strikes, in the order its notes first
   * strike them, keyed by what its kit notes name. MusicXML states a
   * component's staff height on every note struck on it and MNX states it
   * once, so the kit is gathered as the notes are read.
   */
  kit: Map<string, KitComponent>
  /**
   * Which component the source's own way of telling them apart resolves to:
   * the instrument a note names, or, where it names none, the height it is
   * written at.
   */
  kitKeys: Map<string, string>
}

export function newPartState(
  ids: IdGenerator,
  sounds: ReadonlyMap<string, InstrumentSound> = new Map(),
): PartState {
  return {
    divisions: undefined,
    divisionsAssumed: false,
    time: undefined,
    staves: 1,
    clefs: new Map(),
    measure: 0,
    ids,
    spanners: new SpannerResolver(),
    sounds,
    kit: new Map(),
    kitKeys: new Map(),
  }
}
