// What the readers of one part share: the running state a measure cannot be
// read without.

import type {
  Event,
  PitchedClefSign,
  Key,
  KitComponent,
  TimeSignature,
  Transposition,
} from '../model/score.js'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { WarningContext } from '../warnings.js'
import type { XmlElement } from '../xml/parse.js'
import { IdGenerator } from './idGenerator.js'
import { SpannerResolver } from './spanners.js'
import type { CarriedTupletStop } from './tuplets.js'

/**
 * What a note's instrument resolves to: the key the score holds its sound
 * under, and the name to draw beside the component it strikes.
 */
export interface ResolvedSound {
  readonly key: string
  readonly name: string | undefined
}

/**
 * The lines a staff is drawn with where it says nothing, which is what MNX
 * draws when no config names the staff.
 */
export const DEFAULT_STAFF_LINES = 5

/** How many lines a staff of this part is drawn with, as things stand. */
export function staffLinesOf(state: PartState, staff: number | undefined): number {
  return state.staffLines.get(staff ?? 1) ?? DEFAULT_STAFF_LINES
}

/**
 * A MusicXML staff line, counted from 1 at the bottom of the staff, as the
 * MNX staff position it is drawn at, counted in half spaces from the middle
 * of the staff. The middle of a five-line staff is its third line; of a
 * one-line staff, the line itself; of a two-line staff, the space between
 * the two. So the middle moves with the count.
 */
export function staffPositionOfLine(line: number, lines: number): number {
  return 2 * line - lines - 1
}

/**
 * The clef in force on a staff: its sign, and the staff position its
 * reference pitch sits at. The position, not the MusicXML line, because the
 * two match only for a given line count. Heights read against this clef stay
 * in the frame it was written in.
 */
export interface ClefInForce {
  sign: PitchedClefSign
  staffPosition: number
}

/**
 * A key or time signature a measure stated after its start and held for the
 * next one, as PartState.lateKey and PartState.lateTime.
 */
export interface HeldSignature<T> {
  value: T
  partway: boolean
  context: WarningContext
  /** The <key> or <time> stating it. */
  element: XmlElement
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
   * duration; a note with no written value cannot, so it is refused.
   */
  divisionsAssumed: boolean
  /**
   * The time signature the measure being read is measured against, which like
   * <divisions> stays until restated. Only the measure reader sets it: to the
   * one stated where the measure begins, and to one stated after the start
   * once the measure is settled, since that one is the next measure's.
   */
  time: TimeSignature | undefined
  /**
   * A time signature stated after the start of a measure, held for the next
   * one. MNX states a time signature only where a measure begins, so the next
   * measure takes it unless it states its own. Where it was stated partway
   * through the measure rather than after its notes, the move is a loss.
   */
  lateTime: HeldSignature<TimeSignature> | undefined
  /**
   * The key and time signature MNX has in force after the measures read so
   * far. A statement after a measure's start is compared with these rather
   * than with what the source last stated, because the source can state one
   * that is not converted, such as a second one at the measure start.
   */
  convertedKey: Key | undefined
  convertedTime: TimeSignature | undefined
  /** A key signature stated after the start of a measure, held as lateTime is. */
  lateKey: HeldSignature<Key> | undefined
  /**
   * The key and time signature each staff of the part has in force, as the
   * source states them, keyed by staff number. MusicXML states one per staff
   * and MNX states one for the score, so only a staff given one of its own is
   * reported as a loss. A key is held as it sounds, so a part that changes its
   * transposition still compares sounding keys.
   */
  staffKeys: Map<number, Key | undefined>
  staffTimes: Map<number, TimeSignature | undefined>
  /** How many staves the part is written on, once it says. */
  staves: number
  /**
   * The clef in force on each staff, keyed by staff number and updated as
   * clefs are read in document order. A rest placed by <display-step> reads
   * its height against the clef on its staff.
   */
  clefs: Map<number, ClefInForce>
  /**
   * How many lines each staff is drawn with, keyed by staff number, for the
   * staves that state a count other than the five MNX draws by default. A
   * config holds until another replaces it, so a measure carries one only
   * where the count changes.
   */
  staffLines: Map<number, number>
  /** Shared across the score, so every id in the document is distinct. */
  ids: IdGenerator
  /** Per part: a tie or slur may span measures, but not parts. */
  spanners: SpannerResolver
  /**
   * What a note's <instrument> resolves to, keyed as the note names it. A kit
   * component takes its name and its sound from this.
   */
  sounds: ReadonlyMap<string, ResolvedSound>
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
  /**
   * The instrument transposition in force, from the part's <transpose>. Every
   * pitch is carried by it to what the instrument sounds, and the key
   * signature to the key the music sounds in. Undefined until the part states
   * one, which is concert pitch.
   */
  transposition: Transposition | undefined
  /**
   * The <tuplet> stops still to be met: a bracket the reader closed at a
   * barline, because MNX states a tuplet inside one measure, leaves the stop
   * the source wrote in a later measure with nothing to close.
   */
  carriedTupletStops: readonly CarriedTupletStop[]
  /**
   * The first transposition the part stated, which is the one written out.
   * MNX states one per part, so a part that changes instrument partway keeps
   * this one and reports the change.
   */
  statedTransposition: Transposition | undefined
  /**
   * The fermatas past the first that an event's own note wrote, reported as
   * it was read because MNX states one. A note of the chord restating them
   * loses nothing more.
   */
  fermatasPastFirst: WeakMap<Event, readonly XmlElement[]>
}

/**
 * How long the measure being read runs, as its time signature states.
 * Unknown where the part has stated none, or states it is unmetered.
 */
export function measureLength(state: PartState): Fraction | undefined {
  return state.time && fraction(state.time.count, state.time.unit)
}

export function newPartState(
  ids: IdGenerator,
  sounds: ReadonlyMap<string, ResolvedSound> = new Map(),
): PartState {
  return {
    divisions: undefined,
    divisionsAssumed: false,
    time: undefined,
    lateTime: undefined,
    convertedKey: undefined,
    convertedTime: undefined,
    lateKey: undefined,
    staffKeys: new Map(),
    staffTimes: new Map(),
    staves: 1,
    clefs: new Map(),
    staffLines: new Map(),
    ids,
    spanners: new SpannerResolver(),
    sounds,
    kit: new Map(),
    kitKeys: new Map(),
    carriedTupletStops: [],
    transposition: undefined,
    statedTransposition: undefined,
    fermatasPastFirst: new WeakMap(),
  }
}
