// What the readers of one part share: the running state a measure cannot be
// read without.

import type {
  ClefSign,
  Key,
  KitComponent,
  ResolvedSound,
  TimeSignature,
  Transposition,
} from '../model/score.js'
import type { WarningContext } from '../warnings.js'
import { IdGenerator, SpannerResolver } from './spanners.js'
import type { CarriedTupletStop } from './tuplets.js'

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
 * the two. So the middle moves with the count, and a staff drawn on other
 * than five lines places everything on it differently.
 */
export function staffPositionOfLine(line: number, lines: number): number {
  return 2 * line - lines - 1
}

/**
 * The clef in force on a staff: its sign, and the staff position its
 * reference pitch sits at. The position rather than the MusicXML line,
 * because the two are the same thing only on a staff of a given line count,
 * and holding the position keeps every height read against this clef in the
 * frame the clef itself was written in.
 */
export interface ClefInForce {
  sign: ClefSign
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
   * It changes where the source states one, which can be partway through a
   * measure.
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
    staves: 1,
    clefs: new Map(),
    staffLines: new Map(),
    measure: 0,
    ids,
    spanners: new SpannerResolver(),
    sounds,
    kit: new Map(),
    kitKeys: new Map(),
    carriedTupletStops: [],
    transposition: undefined,
    statedTransposition: undefined,
  }
}
