// What the readers of one part share: the running state a measure cannot be
// read without.

import type { OpenExtenders } from './lyrics.js'
import type { PitchedClefSign, KitComponent, TimeSignature } from '../model/score.js'
import type { Fraction } from '../fraction.js'
import { IdGenerator } from './idGenerator.js'
import { OpenBeams } from './beams.js'
import { PartLines } from './lines.js'
import { PartTransposition } from './partTransposition.js'
import { lengthOfTime, PartSignatures } from './partSignatures.js'
import { SpannerResolver } from './spanners.js'
import { SlurResolver } from './slurs.js'
import { TieResolver } from './ties.js'
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
  /** Octaves the clef is transposed for drawing: -1 for a treble-8. */
  octave: number
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
   * follow notes written before a <backup>. A part stating none, or stating
   * it is unmetered, takes the score's.
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
  /** Per part: a hairpin or an octave shift may span measures, but not parts. */
  spanners: SpannerResolver
  /** The same for slurs. */
  slurs: SlurResolver
  /** The same for ties. */
  ties: TieResolver
  /** The melisma lines still open, which a lyric on a later note can reach. */
  lyricExtenders: OpenExtenders
  /** The key and time signatures the part carries from measure to measure. */
  signatures: PartSignatures
  /** The lines each voice is written in, matched from measure to measure. */
  lines: PartLines
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
  /** The instrument transposition, from the part's <transpose>. */
  transposition: PartTransposition
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
  carriedTremolos: readonly (string | undefined)[]
  /** The beams left open at the barline, which the next measure may join. */
  openBeams: OpenBeams
}

/**
 * How long the measure being read runs, as its time signature states.
 * Unknown until a part states a meter.
 */
export function measureLength(state: PartState): Fraction | undefined {
  return state.time && lengthOfTime(state.time)
}

export function newPartState(
  ids: IdGenerator,
  /**
   * Every voice name the part's notes state, in any measure. MNX reads one
   * voice name as one line across the score, so a name built for a laid-over
   * line steps past all of them.
   */
  voiceNames: ReadonlySet<string>,
  sounds: ReadonlyMap<string, ResolvedSound> = new Map(),
): PartState {
  const ties = new TieResolver()
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
    slurs: new SlurResolver(),
    ties,
    lyricExtenders: new Map(),
    signatures: new PartSignatures(),
    lines: new PartLines(voiceNames, (note) => ties.tiesOn(note)),
    sounds,
    kit: new Map(),
    kitKeys: new Map(),
    carriedTupletStops: [],
    carriedTremolos: [],
    openBeams: new OpenBeams(),
    transposition: new PartTransposition(),
  }
}
