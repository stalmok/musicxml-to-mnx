// The lines of a voice in one measure: the sequence each line writes, and the
// handle a note is given to write in it.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import { compareFractions, divideFractions, fraction } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { describeLength, noteValueOf } from './duration.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { EventNotation } from './eventNotations.js'
import type { XmlElement } from '../xml/parse.js'
import { LineBeams } from './beams.js'
import type { BeamedEvent } from './beams.js'
import { TupletTracker } from './tupletTracker.js'
import type { MeasureRest, MeasureRestReports } from './measureRestForms.js'
import type {
  Event,
  EventNotes,
  EventRest,
  FullMeasureRest,
  GraceGroup,
  GraceType,
  NoteValue,
  SequenceItem,
} from '../model/score.js'
import type { Draft } from './draft.js'

/**
 * An event just put in its voice, where it begins in the measure, and how
 * long it lasts. A note's notations are read once the cursor has moved past
 * it, and a tie, slur or roll written there belongs at the event's own place.
 * `duration` is unset on a grace note, which takes no time.
 */
export interface PlacedEvent {
  event: Event
  start: Fraction
  duration: Fraction | undefined
}

/** The event a note of a chord joins, with what the chord's own note wrote on it. */
export interface JoinedEvent extends PlacedEvent {
  notations: readonly EventNotation[]
}

/**
 * The most recent event, which a chord note joins. `share` is how much of its
 * written value it lasts, for chord notes to agree with. It is unset on a
 * grace note, which takes no time.
 */
export interface LastEvent extends JoinedEvent {
  /** Still being made: each note of the chord adds the lyrics it sings. */
  readonly event: Draft<Event>
  readonly share: Fraction | undefined
}

/**
 * The chord a member joins: the line it is in, the event the member is added
 * to, and the staff that event was placed on.
 */
export interface ChordToJoin {
  readonly voice: VoiceLine
  readonly last: LastEvent
  readonly body: EventNotes
  readonly staff: number | undefined
}

/**
 * The grace group a grace note added now would join, if its sides agree: the
 * last item of the voice, or the one written before the brackets this note
 * opened. MNX states a grace group as one item, so a bracket starting on a
 * later grace note of a group takes in the whole group. A group taking its
 * time from the note before it is drawn after that note, so it stays outside
 * the bracket, and the grace note starts a group of its own inside it.
 */
export function graceGroupToJoin(builder: VoiceBuilder): GraceGroup | undefined {
  const last = builder.tuplets.last()
  if (last?.kind === 'grace') return last
  const before = builder.tuplets.lastBeforeOpened()
  return before?.kind === 'grace' && before.graceType !== 'stealPrevious' ? before : undefined
}

/** Where the grace group a grace note added now would join takes its time from. */
function graceTypeOf(builder: VoiceBuilder): GraceType | undefined {
  return graceGroupToJoin(builder)?.graceType
}

export interface VoiceBuilder {
  beams: LineBeams
  /**
   * Which staff each note named, paired with the event that named it. A rest
   * filling the measure names one without being an event, unless it is
   * written as one, so it contributes the staff and nothing to override.
   */
  placed: { event: Event | undefined; staff: number | undefined }[]
  /** The last event that is not a grace note, and the staff it named. */
  lastEvent: { id: string; staff: number | undefined } | undefined
  /**
   * The tuplets and the tremolo open around the next note, and the tuplets
   * closed in this measure, waiting for it to be whole.
   */
  tuplets: TupletTracker
  /** Where this voice's content runs out, measured from the measure start. */
  end: Fraction
  /**
   * The most recent event, which a chord note joins. Held directly rather
   * than looked up, because it can sit inside a tuplet or a grace group that
   * has since closed. `start` is where it begins, held because a chord note
   * is read after the cursor has moved past the event it joins, and an
   * arpeggio over the chord belongs at the event's own place in the measure.
   */
  last: LastEvent | undefined
  /**
   * The grace group at the end of this sequence that is still waiting for
   * the note it ornaments, where the sequence ends in one. `at` is where it
   * stands, `beams` is the run its own beams are read into and `placedFrom`
   * is where its notes begin in `placed`, so that the whole of it can follow
   * its note into another sequence of the voice.
   */
  grace: { group: GraceGroup; beams: BeamedEvent[]; at: Fraction; placedFrom: number } | undefined
  /**
   * The note that opened this sequence, where it is a line laid over the
   * voice rather than the voice's first. The split is reported at that note.
   */
  openedAt: XmlElement | undefined
  measureRest: MeasureRest | undefined
  /** The rest the sequence states, set once the measure is whole. */
  fullMeasure: FullMeasureRest | undefined
  /** How much of the measure each event this voice holds takes. */
  spent: Map<SequenceItem, Fraction>
}

/**
 * The sequences one <voice> is read into. A voice sounds one note at a time,
 * so it is one sequence in all but a known dialect: closed-score hymnals
 * write two lines in one voice, laid over each other with <backup> and told
 * apart only by how they are drawn. MNX states each line as its own sequence
 * of the measure, so a note written where its voice is still sounding opens
 * another here rather than refusing the file.
 *
 * `active` is the one what comes next is written in, which is the one the
 * most recent note went to: a chord member, a beam marker and a tuplet
 * marker all belong to the note before them.
 */
export interface VoiceLayers {
  layers: VoiceBuilder[]
  active: number
}

// The measure builder alone reaches the sequence behind a line, and makes
// lines.
let layerOfLine: (line: VoiceLine) => VoiceBuilder
let makeLine: (name: string | undefined, layer: VoiceBuilder) => VoiceLine

export function layerOf(line: VoiceLine): VoiceBuilder {
  return layerOfLine(line)
}

export function newLine(name: string | undefined, layer: VoiceBuilder): VoiceLine {
  return makeLine(name, layer)
}

/**
 * The line of a voice a note is written in. The builder hands one out as the
 * note begins, and everything the note asks of its voice, or adds to it, goes
 * through it, so it all reaches the one sequence. A chord member takes its
 * chord's line, and a grace note the one its voice last sounded in.
 */
export class VoiceLine {
  /** The sequence it writes. */
  readonly #layer: VoiceBuilder

  private constructor(
    /** The voice as the source named it, where it names one. */
    readonly name: string | undefined,
    layer: VoiceBuilder,
  ) {
    this.#layer = layer
  }

  static {
    layerOfLine = (line) => line.#layer
    makeLine = (name, layer) => new VoiceLine(name, layer)
  }

  /**
   * Where the grace group open in this line takes its time from, or nothing
   * where the group says nothing. A grace note taking another side starts a
   * group of its own, and a grace chord member has to agree with it.
   */
  graceType(): GraceType | undefined {
    return graceTypeOf(this.#layer)
  }

  /**
   * How much of its written value a note in this line lasts, as the product of
   * every tuplet currently open around it: 2/3 inside a triplet, and the
   * ratios multiply where tuplets nest. Inside a two-note tremolo each note
   * is written with the value of the pair, so it lasts half of it.
   */
  noteFactor(): Fraction {
    return this.#layer.tuplets.noteFactor()
  }

  /**
   * The ratio of each tuplet open in this line, where the source stated every
   * one of them.
   */
  statedTupletRatios(): Fraction[] | undefined {
    return this.#layer.tuplets.statedRatios()
  }

  /**
   * What is open around a note in this line scaling its written value, for a
   * report to name.
   */
  scaledBy(): 'tuplet' | 'tremolo' | undefined {
    return this.#layer.tuplets.scaledBy()
  }

  /** Whether a tuplet or a tremolo is open around a note in this line. */
  insideBracket(): boolean {
    return this.#layer.tuplets.insideBracket()
  }

  /** Whether this line is inside a tuplet stated as a ratio with no bracket. */
  insideImpliedTuplet(): boolean {
    return this.#layer.tuplets.insideImplied()
  }

  /** Whether a two-note tremolo is open in this line. */
  insideTremolo(): boolean {
    return this.#layer.tuplets.insideTremolo()
  }

  /**
   * Whether the tuplet the ratio alone opened in this line holds all its
   * ratio counts. False where no such tuplet is open.
   */
  impliedTupletFilled(): boolean {
    return this.#layer.tuplets.impliedFilled()
  }

  /**
   * Records a tuplet this line never opened, by the number its start marker
   * stated, so the stop that matches it can be dropped with it.
   */
  dropTupletStart(number: string): void {
    this.#layer.tuplets.dropStart(number)
  }

  /**
   * Closes the tremolo: two notes of one written value, together occupying
   * twice their measured duration. A stop where none is open is converted as
   * a plain note. Anything else is refused, because the measure would not add
   * up.
   */
  closeTremolo(
    marker: { marks: number; element: XmlElement },
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const { marks } = marker
    const builder = this.#layer
    // A stop where no tremolo was open opened one around its own note, so
    // that note is all the tremolo holds. It was reported where it opened, or
    // at the barline that cut the tremolo off.
    if (builder.tuplets.tremoloOpenedBy(marker.element)) {
      builder.tuplets.convertUnclosedTremolo(path, line)
      return
    }
    const pending = builder.tuplets.closeTremolo()

    // Both ends count the beams joining the pair, and there is one pair to
    // draw.
    if (marks !== pending.marks) {
      warnings.add(
        'inconsistent:tremolo',
        'The two ends of a tremolo count different beams. The count where it starts ' +
          'is the one converted.',
        context,
        marker.element,
      )
    }

    const content = pending.list
    const events = content.filter((item): item is Event => item.kind === 'event')
    if (events.length !== 2 || content.length !== 2) {
      throw new MusicXMLError(
        'A tremolo written across two notes holds something other than two notes.',
        { path, line },
      )
    }

    const [first, second] = pending.durations
    if (!first || !second || compareFractions(first, second) !== 0) {
      throw new MusicXMLError('The two notes of a tremolo last different times.', { path, line })
    }

    // The time the tremolo occupies, stated one unit per note as MNX has it:
    // a pair of written halves occupies two quarters. Inside a tuplet
    // everything is stated in written values the ratio scales, so the
    // measured duration is unscaled back into them first.
    const unit = noteValueOf(divideFractions(first, builder.tuplets.tupletFactor()))
    if (!unit) {
      throw new MusicXMLError(
        `A note of a tremolo lasts ${describeLength(first)}, which no note value can write.`,
        { path, line },
      )
    }

    builder.tuplets.append({
      kind: 'multiNoteTremolo',
      marks: pending.marks,
      outer: { value: unit, multiple: 2 },
      content: events,
    })
  }

  /**
   * Converts the tremolo open in this line as the plain notes it holds, where
   * a note that does not stop it follows its first note.
   */
  convertUnstoppedTremolo(
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const unclosed = this.#layer.tuplets.convertUnclosedTremolo(path, line)
    if (!unclosed) return
    warnings.add(
      'unclosed:tremolo',
      'A two-note tremolo is not stopped by the note after it. Its note is converted as ' +
        'a plain note, half the value it is written as.',
      context,
      unclosed,
    )
  }

  /**
   * Moves the brackets numbered in `stopping` inside the others opened on the
   * same note in this line. See TupletTracker.nestStopping.
   */
  nestStoppingTuplets(stopping: ReadonlySet<string>): void {
    this.#layer.tuplets.nestStopping(stopping)
  }

  /**
   * Closes the innermost open tuplet in this line, handing back the number
   * its start marker stated, or nothing where no tuplet is open. `stop` is
   * the <tuplet> marker closing it.
   */
  closeTuplet(
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
    stop: XmlElement,
  ): string | undefined {
    const builder = this.#layer
    return builder.tuplets.closeTuplet(builder.end, warnings, context, path, line, stop)
  }
  /**
   * Marks the rest just added as one that could be this line's measure rest,
   * to be settled by finish once the voice is whole.
   */
  markMeasureRest(
    event: Event,
    body: EventRest,
    drawn: NoteValue,
    reports: MeasureRestReports<'sequence' | 'event'>,
  ): void {
    this.#layer.measureRest = { origin: 'candidate', event, body, drawn, reports }
  }
}

export function newVoiceBuilder(openedAt?: XmlElement): VoiceBuilder {
  return {
    openedAt,
    beams: new LineBeams(),
    placed: [],
    lastEvent: undefined,
    tuplets: new TupletTracker(),
    end: fraction(0),
    last: undefined,
    grace: undefined,
    measureRest: undefined,
    fullMeasure: undefined,
    spent: new Map(),
  }
}
