// What the readers of one part share: the running state a measure cannot be
// read without.

import type { ReportContext, WarningPlace } from './collector.js'
import type { PitchedClefSign, KitComponent, TimeSignature, Transposition } from '../model/score.js'
import { fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { XmlElement } from '../xml/parse.js'
import type { Stated } from './element.js'
import { IdGenerator } from './idGenerator.js'
import { PartSignatures } from './partSignatures.js'
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
 * What a part carries from one measure to the next. `<divisions>` is stated
 * once and stays in force until restated, so a measure is not readable on its
 * own.
 */
export interface PartState {
  divisions: Fraction | undefined
  /**
   * Whether the divisions in force are an assumption rather than something
   * the file stated. A written note value can be checked against an assumed
   * duration; a note with no written value cannot, so it is refused.
   */
  divisionsAssumed: boolean
  /**
   * The time signature the measure being read is measured against, which like
   * <divisions> stays until restated. Set before the measure is walked, to the
   * one timesInForce reads ahead for it, since a statement at the start can
   * follow notes written before a <backup>.
   */
  time: TimeSignature | undefined
  /** How many staves the part is written on, once it says. */
  staves: number
  /**
   * The most staves the part has had. MNX states one count for the whole
   * part, so a staff the part drops stays in the output.
   */
  mostStaves: number
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
  /** The key and time signatures the part carries from measure to measure. */
  signatures: PartSignatures
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
   * signature to the key the music sounds in. Undefined at concert pitch.
   */
  transposition: Transposition | undefined
  /**
   * The <tuplet> stops still to be met: a bracket the reader closed at a
   * barline, because MNX states a tuplet inside one measure, leaves the stop
   * the source wrote in a later measure with nothing to close.
   */
  carriedTupletStops: readonly CarriedTupletStop[]
  /**
   * The voices whose two-note tremolo the last measure left open at its
   * barline. The note that stops it, where the voice's next note does, is
   * converted as one already reported.
   */
  carriedTremolos: readonly string[]
  /**
   * The voices whose primary beam the last measure left open at its barline,
   * with the staff it was on.
   */
  beamsOpenAtBarline: ReadonlyMap<string, number | undefined>
  /**
   * The first transposition in force at a pitched note, which is the one
   * written out. MNX states one per part, so a part that changes instrument
   * partway keeps this one and reports the change. A part with no pitched
   * note keeps the one its first key is converted with, or else the last one
   * in force. Undefined until the part is fixed; a value of undefined is
   * concert pitch.
   */
  statedTransposition: { value: Transposition | undefined } | undefined
  /**
   * The keys converted before the part is fixed, each with the transposition
   * it was converted with. Each is checked against the one the part is fixed
   * in.
   */
  unfixedKeys: {
    transposition: Transposition | undefined
    place: WarningPlace
    context: ReportContext
    element: XmlElement
  }[]
  /**
   * The transposition each staff was last given, with the <transpose> that
   * gave it. A <transpose> naming no staff gives every staff, including any
   * the part adds later, and clears what single staves were given before it.
   * A staff given none sounds as written.
   */
  staffTranspositions: {
    every: Stated<Transposition> | undefined
    staves: Map<number, Stated<Transposition>>
  }
  /**
   * Where the reports about a measure's <transpose> statements go, once the
   * measure is read to its end.
   */
  transpositionCheck:
    | {
        place: WarningPlace
        context: ReportContext
        /**
         * The measure's first <transpose>, or the <staves> that changed the
         * transposition in force where the measure states none.
         */
        element: XmlElement
        /** Every <transpose> the measure states. */
        stated: Set<XmlElement>
        /**
         * The measure's first <transpose> or <staves> that puts the part in
         * a transposition other than the one it is written out in.
         */
        change: XmlElement | undefined
      }
    | undefined
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
    staves: 1,
    mostStaves: 1,
    clefs: new Map(),
    staffLines: new Map(),
    ids,
    spanners: new SpannerResolver(),
    signatures: new PartSignatures(),
    sounds,
    kit: new Map(),
    kitKeys: new Map(),
    carriedTupletStops: [],
    carriedTremolos: [],
    beamsOpenAtBarline: new Map(),
    transposition: undefined,
    statedTransposition: undefined,
    unfixedKeys: [],
    staffTranspositions: { every: undefined, staves: new Map() },
    transpositionCheck: undefined,
  }
}
