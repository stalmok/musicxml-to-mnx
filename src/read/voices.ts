// Turning MusicXML's one stream per measure into MNX's one sequence per voice.
//
// MusicXML writes a measure as a single stream with a cursor. Notes advance
// it, <backup> rewinds it so another voice can be written over the same span,
// <forward> skips ahead, and <chord> attaches a note to the one before it
// without moving at all. MNX instead states each voice separately, and each
// sequence runs without interruption from wherever it begins.
//
// So the reader has to follow the cursor, sort what it finds into voices, and
// state as a space anything a voice passes over in silence.

import { MusicXMLError } from '../errors.js'
import type { DocumentPath } from '../errors.js'
import {
  addFractions,
  compareFractions,
  divideFractions,
  fraction,
  multiplyFractions,
  subtractFractions,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { describeLength, noteValueOf } from './duration.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { BeamedEvent } from './beams.js'
import {
  countedLengthOf,
  ratioOf,
  sameCounts,
  settleClaims,
  tupletFilled,
  tupletLevels,
  unwrapTuplet,
  writtenLengthOf,
} from './tuplets.js'
import type {
  CarriedTupletStop,
  MeasureExtent,
  OpenTuplet,
  TupletClaim,
  TupletStart,
} from './tuplets.js'
import type {
  Arpeggio,
  Draft,
  Event,
  FullMeasureRest,
  GraceGroup,
  GraceType,
  KitComponent,
  KitNote,
  Note,
  NoteValue,
  NoteValueQuantity,
  Pitch,
  Sequence,
  SequenceItem,
  Space,
  TieTarget,
  Tuplet,
} from '../model/score.js'

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

/**
 * An event just put in its voice, and where it begins in the measure. A note's
 * notations are read once the cursor has moved past it, and a tie, slur or
 * roll written there belongs at the event's own place.
 */
export interface PlacedEvent {
  event: Event
  start: Fraction
}

/** What a measure holds once every pass that waits for it to be whole has run. */
export interface FinishedMeasure {
  /** Each voice's events, in order, for its beams to be read from. */
  beamedEvents: BeamedEvent[][]
  arpeggios: Arpeggio[]
  sequences: Sequence[]
  /** Tuplet stops no bracket here met, handed on to the next measure. */
  carriedTupletStops: CarriedTupletStop[]
}

/** The name a voice goes under when the source does not give it one. */
const UNNAMED_VOICE = ''

/**
 * A two-note tremolo currently being gathered: the notes it holds are kept
 * apart from the content, and join it as one item once it closes.
 */
interface OpenTremolo {
  opened: 'tremolo'
  list: SequenceItem[]
  marks: number
  durations: Fraction[]
}

/**
 * One bracket the voice is inside. A tuplet and a tremolo each gather what
 * is written in them, and each carries what it needs to close, so closing
 * one while the other is open cannot pop the wrong frame and lose what it
 * held.
 */
type OpenBracket = OpenTuplet | OpenTremolo

interface VoiceBuilder {
  /** What each event said about its beams, in the order they were read. */
  beamed: BeamedEvent[]
  /**
   * The same for the grace notes, kept apart from the rest. A grace group
   * beams within itself, so its markers have to be read as their own run: a
   * group sitting between two beamed notes would otherwise open a beam in the
   * middle of theirs and leave the outer one with no end to close it.
   */
  graceBeamed: BeamedEvent[][]
  /**
   * Which staff each note named, paired with the event that named it. A rest
   * filling the measure names one without being an event, so it contributes
   * the staff and nothing to override.
   */
  placed: { event: Event | undefined; staff: number | undefined }[]
  /**
   * The brackets this voice is inside, outermost first. Notes land in the
   * innermost one's list, or in `content` where none is open. No bracket
   * opens inside a tremolo, so a tremolo is always the innermost.
   */
  open: OpenBracket[]
  /**
   * The numbers of tuplets whose start marker was read but never opened,
   * because it was written where no bracket can begin. The stop matching one
   * is dropped with it, rather than closing the bracket around it.
   */
  droppedTuplets: string[]
  /**
   * What the most recent event's own note said about tuplets, as the type and
   * number of each marker it carried. A chord member repeating one of these
   * is drawing the chord's bracket, not naming a bracket of its own.
   */
  eventTupletMarkers: readonly string[]
  content: SequenceItem[]
  /** Where this voice's content runs out, measured from the measure start. */
  end: Fraction
  /**
   * The most recent event, which a chord note joins. Held directly rather
   * than looked up, because it can sit inside a tuplet or a grace group that
   * has since closed. `duration` is how long it lasts, for chord notes to
   * agree with, and is unset on a grace note, which takes no time. `start` is
   * where it begins, held because a chord note is read after the cursor has
   * moved past the event it joins, and an arpeggio over the chord belongs at
   * the event's own place in the measure.
   */
  last: { event: Event; duration: Fraction | undefined; start: Fraction } | undefined
  /**
   * The grace group at the end of this sequence that is still waiting for
   * the note it ornaments, where the sequence ends in one. `at` is where it
   * stands, `beams` is the run its own beams are read into and `placedFrom`
   * is where its notes begin in `placed`, so that the whole of it can follow
   * its note into another sequence of the voice.
   */
  grace: { group: GraceGroup; beams: BeamedEvent[]; at: Fraction; placedFrom: number } | undefined
  /**
   * The line of the note that opened this sequence, where it is a line laid
   * over the voice rather than the voice's first. The split is reported
   * there: the measure would do, but the note is what the source wrote.
   */
  openedAt: number | undefined
  fullMeasure: FullMeasureRest | undefined
  /**
   * Whether a rest filling this voice's measure stands in its content as an
   * event, where it carries something the sequence cannot hold. The voice
   * rests the measure all the same.
   */
  restsMeasureAsEvent: boolean
  /**
   * What the rest filling this voice's measure goes back to being where
   * something that only an event can hold is written after it, and nothing
   * where no note value can write the rest. `at` is where the rest stands,
   * `after` where the voice's content ran out before it, and `staff` the
   * staff it named. See restoreMeasureRest.
   */
  restAsEvent:
    | {
        event: () => Event
        duration: Fraction
        at: Fraction
        after: Fraction
        staff: number | undefined
      }
    | undefined
  /**
   * A rest that may turn out to be this voice's measure rest, held until the
   * voice is whole. See settleMeasureRests.
   */
  measureRest: MeasureRestCandidate | undefined
  /**
   * The brackets this voice has closed, outermost first in the order the
   * source closed them. Each waits for the measure to be whole. See
   * TupletClaim.
   */
  claims: TupletClaim[]
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
interface VoiceLayers {
  layers: VoiceBuilder[]
  active: number
}

/** A rest standing where its voice's measure rest would stand. */
interface MeasureRestCandidate {
  readonly event: Event
  /**
   * Reports the written value disagreeing with how long the rest lasts, for
   * the reading where the rest stays an ordinary event.
   */
  readonly reportMismatch: () => void
}

/** A chord marked as rolled or struck, held until its notes are all in. */
interface MarkedArpeggio {
  event: Event
  /**
   * The notes that carried this mark. They are what the roll spans where the
   * chord is divided between two numbered rolls; anywhere else the chord it
   * sits on is what the roll spans, because that is what is drawn.
   */
  notes: Note[]
  position: Fraction
  /**
   * What the source numbers it, where it numbers it at all. Two chords
   * sounding together under the same number are one arpeggio rolled across
   * both, which is how a pianist's two hands are rolled as one gesture;
   * different numbers are two separate rolls. Eleven of the corpus's are the
   * cross-staff kind. A marker stating no number joins nothing beyond its own
   * chord: the number is what makes the claim, and reading a default as one
   * ran a roll across both hands that neither voice asked for.
   */
  number: string | undefined
  struck: boolean
  /**
   * The line the mark was written on. A roll is reported once the measure is
   * whole, when the element it came from is gone, so the line comes along
   * with the mark rather than being looked up again.
   */
  line: number
  /** True where the same chord was marked the other way as well. */
  conflicted: boolean
  /** True where the same chord was rolled in both directions at once. */
  crossed: boolean
  direction: 'up' | 'down' | undefined
  arrow: boolean
}

/**
 * Where a note sits on the staff, as a number that orders it against others.
 * Diatonic rather than chromatic, because a bracket spans what is drawn, and
 * two notes a semitone apart can be drawn on the same line.
 */
function staffOrder(pitch: Pitch): number {
  return pitch.octave * 7 + 'CDEFGAB'.indexOf(pitch.step)
}

/**
 * The notes of a kit chord, bottom to top. Ordered by walking the kit in
 * height order rather than by looking each note's component up, so a
 * component the kit does not hold cannot come back as a height of nothing.
 */
function kitOrder(
  notes: readonly KitNote[],
  kit: ReadonlyMap<string, KitComponent>,
): readonly KitNote[] {
  return [...kit]
    .sort(([, a], [, b]) => a.staffPosition - b.staffPosition)
    .flatMap(([component]) => notes.filter((note) => note.component === component))
}

/** The staff a voice is mostly on, or nothing when it names no staff at all. */
/** The staff a voice is mostly on, or nothing when it names no staff at all. */
function commonestStaff(staves: readonly (number | undefined)[]): number | undefined {
  const counts = new Map<number, number>()
  for (const staff of staves) {
    if (staff !== undefined) counts.set(staff, (counts.get(staff) ?? 0) + 1)
  }

  let commonest: number | undefined
  let seen = 0
  // Ties go to the staff seen first, which the insertion order gives.
  for (const [staff, count] of counts) {
    if (count > seen) {
      commonest = staff
      seen = count
    }
  }
  return commonest
}

/**
 * The list a note added now would land in: the innermost bracket's, or the
 * voice's own where no bracket is open.
 */
function innermost(builder: VoiceBuilder): SequenceItem[] {
  return builder.open.at(-1)?.list ?? builder.content
}

/** The tuplet the ratio alone opened, where the voice is inside one. */
function impliedFrame(builder: VoiceBuilder): OpenTuplet | undefined {
  const open = builder.open.at(-1)
  return open?.opened === 'tuplet' && open.unbracketed ? open : undefined
}

/** The tuplets open around a note, outermost first. */
function tupletFrames(builder: VoiceBuilder): OpenTuplet[] {
  return builder.open.filter((frame) => frame.opened === 'tuplet')
}

/**
 * The tremolo being gathered, when one is. No bracket opens inside a tremolo,
 * so it is the innermost frame whenever there is one.
 */
function tremoloFrame(builder: VoiceBuilder): OpenTremolo | undefined {
  const frame = builder.open.at(-1)
  return frame?.opened === 'tremolo' ? frame : undefined
}

/** How much of its written value a note lasts, given the tuplets around it. */
function tupletFactorOf(builder: VoiceBuilder): Fraction {
  return tupletFrames(builder)
    .map((open) => open.ratio)
    .reduce(multiplyFractions, fraction(1))
}

/**
 * Collects a measure's notes into per-voice sequences while following
 * MusicXML's cursor. Callers push what they read in document order.
 */
export class MeasureBuilder {
  readonly #voices = new Map<string, VoiceLayers>()
  readonly #arpeggios: MarkedArpeggio[] = []
  /** The stops carried in from the measures before, consumed as they are met. */
  readonly #carriedStops: CarriedTupletStop[]
  /**
   * Where each event of the measure begins, whatever voice it is in, the
   * staff it was placed on, and whether it is a grace note. An event states
   * no staff where the part has only one, and where a multi-staff part leaves
   * it off, which MusicXML reads as the first staff.
   */
  readonly #eventStarts: { start: Fraction; staff: number | undefined; grace: boolean }[] = []
  #cursor: Fraction = fraction(0)
  /**
   * The furthest the cursor has run in the measure, over notes, rests filling
   * the measure and <forward> alike: a <forward> is how MusicXML writes
   * silence it draws nothing for.
   */
  #furthest: Fraction = fraction(0)
  /** The voice of the most recent event, which a chord member joins. */
  #lastVoice: string | undefined
  /**
   * The <backup> that carried the cursor before the measure start, held until
   * something is written out there or a <forward> brings the cursor back.
   */
  #reached: { warnings: WarningCollector; context: WarningContext; line: number } | undefined

  constructor(carriedStops: readonly CarriedTupletStop[] = []) {
    this.#carriedStops = [...carriedStops]
  }

  /**
   * Where the cursor has reached, from the start of the measure. A <backup>
   * that carried it before the start reads as the start, since nothing sounds
   * before a measure begins; the cursor itself is left where the source put
   * it, because a <forward> can still bring it back.
   */
  position(): Fraction {
    return compareFractions(this.#cursor, fraction(0)) < 0 ? fraction(0) : this.#cursor
  }

  /** The furthest the cursor has run in the measure. */
  furthest(): Fraction {
    return this.#furthest
  }

  /**
   * Moves the cursor, as <backup> and <forward> do.
   *
   * A <backup> reaching past the start of the measure is how exporters return
   * to the start of a measure a voice has not filled: the source backs up by
   * the whole measure's length whatever that voice wrote. Refusing the
   * document over it lost three songs of the Lieder corpus, so whatever is
   * written out there is written at the start instead.
   *
   * The cursor itself is left where the source put it, because a <forward>
   * can bring it back: sources write the pair to reach a point they draw at
   * the measure start, and taking the cursor to the start on the <backup>
   * alone made the <forward> carry everything after it that much later. The
   * <backup> that reached out is held rather than reported, so that a reach
   * a <forward> cancels is reported not at all and a reach several
   * <forward>s cancel is reported once.
   */
  shift(by: Fraction, warnings: WarningCollector, context: WarningContext, line: number): void {
    this.#moveTo(addFractions(this.#cursor, by))
    if (compareFractions(this.#cursor, fraction(0)) >= 0) {
      this.#reached = undefined
      return
    }
    this.#reached ??= { warnings, context, line }
  }

  /**
   * The cursor where something is about to be written, and where it then
   * stays: writing at the measure start settles what a <backup> reaching
   * past it meant, and no later <forward> can take that back. The reach is
   * reported here, because this is where it costs the source something.
   */
  #writeAt(): void {
    if (compareFractions(this.#cursor, fraction(0)) >= 0) return

    const reached = this.#reached
    /* v8 ignore next -- the cursor goes negative only through shift(). */
    if (reached) {
      reached.warnings.add(
        'inconsistent:backup',
        'A <backup> reaches back further than the measure has run, and the music written ' +
          'out there is written at the start of the measure instead.',
        { ...reached.context, line: reached.line },
        'backup',
      )
    }
    this.#reached = undefined
    this.#cursor = fraction(0)
  }

  /**
   * Passes over the time a note takes without writing it, as a note dropped
   * for being written over a rest that already fills the measure is. The note
   * stood where the cursor stands, so a cursor carried before the measure
   * start is taken to the start first, as it would be for a note written out.
   */
  passOver(by: Fraction): void {
    this.#writeAt()
    this.#moveTo(addFractions(this.#cursor, by))
  }

  #moveTo(position: Fraction): void {
    this.#cursor = position
    if (compareFractions(position, this.#furthest) > 0) this.#furthest = position
  }

  /**
   * Whether any line of this voice is already a rest filling the measure.
   * Asked across all of them, because resting the measure is something the
   * voice does rather than one of its lines: a second rest written over the
   * first is silence over silence whichever line it would go to.
   */
  hasFullMeasure(voice: string | undefined): boolean {
    return this.#layersFor(voice).layers.some(
      (layer) => layer.fullMeasure !== undefined || layer.restsMeasureAsEvent,
    )
  }

  /**
   * Whether this voice holds grace notes and nothing else. They take none of
   * the measure's time, so such a voice is silent through it.
   */
  holdsOnlyGraceNotes(voice: string | undefined): boolean {
    const { content } = this.#builderFor(voice)
    return content.length > 0 && content.every((item) => item.kind === 'grace')
  }

  /**
   * Whether the cursor stands where the measure begins. A <backup> reaching
   * past the start counts as the start, because that is where what follows
   * is written.
   */
  atMeasureStart(): boolean {
    return compareFractions(this.position(), fraction(0)) === 0
  }

  /**
   * Whether this voice holds nothing yet and the cursor stands where the
   * measure begins, so what comes next is the first thing the voice sounds.
   */
  opensMeasure(voice: string | undefined): boolean {
    return this.#builderFor(voice).content.length === 0 && this.atMeasureStart()
  }

  /**
   * Settles which sequence of a voice the note now being read is written in.
   * Called before anything asks the voice what is open around it, because a
   * note laid over what its voice is still sounding goes to a sequence of
   * its own, and the ratio scaling it, the brackets holding it, the beams
   * joining it and the grace notes ornamenting it all have to reach the same
   * one.
   *
   * A chord member and a grace note settle nothing: both stand where the
   * note they were written against stands, and belong to the sequence it
   * went to.
   */
  beginNote(voice: string | undefined, line: number): void {
    this.#writeAt()
    const layers = this.#layersFor(voice)
    const before = layers.layers[layers.active] as VoiceBuilder
    const taken = this.#layerAt(voice, line)
    if (taken !== before) this.#carryGrace(before, taken)
  }

  /**
   * Moves a grace group waiting where the cursor stands into the sequence
   * the note it ornaments turned out to take.
   *
   * A grace note takes none of the measure's time, so which line it belongs
   * to is not readable where it stands: it is the line of the note it leads
   * into, and that note may not be read for another <backup> or <forward>.
   * Reading the group into the line the voice last sounded in and carrying
   * it across settles it at the note, which is the first point the source
   * has said enough.
   *
   * A group taking its time from the note before it is drawn after that
   * note, so it belongs to the line that note is in and stays there.
   */
  #carryGrace(from: VoiceBuilder, to: VoiceBuilder): void {
    const waiting = from.grace
    if (!waiting || compareFractions(waiting.at, this.#cursor) !== 0) return
    if (waiting.group.graceType === 'stealPrevious') return

    // The group is the last thing written in the sequence it is leaving.
    // This runs as the note is read and before the note opens or closes a
    // bracket of its own, so nothing has been written since the group was.
    // The sequence it joins may have been silent since it last sounded, and
    // that silence comes before the group.
    innermost(from).pop()
    this.#fillGap(to)
    innermost(to).push(waiting.group)
    from.graceBeamed = from.graceBeamed.filter((run) => run !== waiting.beams)
    to.graceBeamed.push(waiting.beams)
    to.placed.push(...from.placed.splice(waiting.placedFrom))
    to.last = from.last
    to.grace = { ...waiting, placedFrom: to.placed.length - waiting.group.content.length }
    from.grace = undefined
  }

  /**
   * Adds a note that stands on its own, at the cursor, and advances past it.
   * A gap since this voice last sounded becomes a space.
   */
  addEvent(
    voice: string | undefined,
    event: Event,
    duration: Fraction,
    path: DocumentPath,
    line: number,
    staff?: number,
  ): PlacedEvent {
    const { fullMeasure, restsMeasureAsEvent } = this.#builderFor(voice)
    if (fullMeasure || restsMeasureAsEvent) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    const builder = this.#builderFor(voice)
    this.#fillGap(builder)

    innermost(builder).push(event)
    // A bracket completed once the measure is whole can take in a rest
    // written straight after it, where the source drew that rest as one of
    // the tuplet's own notes and left it outside the bracket. Telling one
    // from a rest that lasts what it is written as needs the time the source
    // gave it, which nothing else keeps. Kept for every event, so that
    // anything standing in a voice's list has one.
    builder.spent.set(event, duration)
    builder.grace = undefined
    builder.placed.push({ event, staff })
    this.#lastVoice = voice ?? UNNAMED_VOICE
    const start = this.#cursor
    builder.last = { event, duration, start }
    this.#eventStarts.push({ start, staff, grace: false })
    tremoloFrame(builder)?.durations.push(duration)
    builder.end = addFractions(start, duration)
    this.#moveTo(builder.end)
    return { event, start }
  }

  /**
   * States as a space whatever time this voice has passed over in silence
   * since it last sounded. MusicXML leaves such a gap implicit by moving its
   * cursor; MNX has to state it, because a sequence runs without interruption
   * from wherever it starts.
   *
   */
  #fillGap(builder: VoiceBuilder): void {
    // A voice that is a rest filling the measure holds no sequence to state
    // one in: it is already silent for the whole measure, and a note written
    // over it is dropped rather than added, which is the only way the cursor
    // runs ahead of such a voice.
    if (builder.fullMeasure) return
    const gap = subtractFractions(this.#cursor, builder.end)
    if (compareFractions(gap, fraction(0)) > 0) {
      // Inside a tuplet everything is written in values the ratio scales, so
      // a gap there is stated in written units: a skipped triplet eighth is
      // written as an eighth even though it lasts a twelfth of a whole note.
      const space: Draft<Space> = {
        kind: 'space',
        duration: divideFractions(gap, tupletFactorOf(builder)),
      }
      innermost(builder).push(space)
      // A bracket rewritten when it closes moves the frame this length was
      // taken in, so the skip waits for it. A tremolo is the innermost frame
      // whenever there is one, and states what it holds itself.
      const around = builder.open.at(-1)
      if (around?.opened === 'tuplet') around.skips.push({ space, spent: gap })
      builder.end = this.#cursor
    }
  }

  /**
   * Settles every bracket of the measure, the measure being whole.
   *
   * What a bracket writes turns on what it holds once the brackets inside it
   * are written, on the frame the brackets around it write in, and on the
   * silence after it, and none of the three is known while it is being read.
   *
   * `measure` is the measure's own shape: where its beats line up, how far it
   * runs, and the time signature it runs against.
   */
  #settleMeasure(
    measure: MeasureExtent,
    warnings: WarningCollector,
    context: WarningContext,
  ): void {
    for (const builder of this.#allBuilders()) {
      const voice = {
        content: builder.content,
        end: builder.end,
        measure,
        spent: builder.spent,
      }
      builder.end = settleClaims(builder.claims, voice, warnings, context)
      builder.claims.length = 0
    }
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
  #lastEventBefore(position: Fraction, staff?: number): CoveredEvent | undefined {
    let latest: Fraction | undefined
    for (const event of this.#eventStarts) {
      if (staff !== undefined && (event.staff ?? 1) !== staff) continue
      if (compareFractions(event.start, position) >= 0) continue
      if (!latest || compareFractions(event.start, latest) > 0) latest = event.start
    }
    if (!latest) return undefined

    const here = this.#eventStarts.filter(
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
    return this.#eventStarts.filter(
      (event) =>
        event.grace &&
        (staff === undefined || (event.staff ?? 1) === staff) &&
        compareFractions(event.start, position) === 0,
    ).length
  }

  /**
   * Where the grace group a chord note is joining takes its time from, or
   * nothing where the group says nothing. The group is the last thing added,
   * so this is what a member of it has to agree with.
   */
  openGraceType(voice: string | undefined): GraceType | undefined {
    const last = innermost(this.#builderFor(voice ?? this.#lastVoice)).at(-1)
    return last?.kind === 'grace' ? last.graceType : undefined
  }

  /** The staff the event a chord note would join was placed on. */
  staffOfChord(voice: string | undefined): number | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).placed.at(-1)?.staff
  }

  /** The written value of the event a chord note would join. */
  chordValue(voice: string | undefined): NoteValue | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).last?.event.value
  }

  /** How long the event a chord note would join lasts. */
  chordDuration(voice: string | undefined): Fraction | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).last?.duration
  }

  /**
   * Adds a note carrying <chord>, which sounds with the event before it
   * rather than after. The cursor does not move.
   */
  addChordNote(
    voice: string | undefined,
    note: Note,
    duration: Fraction | undefined,
    path: DocumentPath,
    line: number,
  ): PlacedEvent {
    const placed = this.#chordEvent(voice, duration, path, line)
    placed.event.notes = [...placed.event.notes, note]
    return placed
  }

  /** The same, for a note struck on a percussion kit. */
  addChordKitNote(
    voice: string | undefined,
    note: KitNote,
    duration: Fraction | undefined,
    path: DocumentPath,
    line: number,
  ): PlacedEvent {
    const placed = this.#chordEvent(voice, duration, path, line)
    placed.event.kitNotes = [...placed.event.kitNotes, note]
    return placed
  }

  /** The event a chord member joins, held to lasting as long as the chord. */
  #chordEvent(
    voice: string | undefined,
    duration: Fraction | undefined,
    path: DocumentPath,
    line: number,
  ): PlacedEvent {
    const builder = this.#builderFor(voice ?? this.#lastVoice)
    const previous = builder.last
    if (!previous) {
      throw new MusicXMLError('A <note> is marked as a chord with no note for it to join.', {
        path,
        line,
      })
    }

    // The event a note joins has to be a note itself. A rest sounds nothing,
    // so a note written onto one has no chord to be part of, the same way a
    // rest written into a chord has none.
    if (previous.event.isRest) {
      throw new MusicXMLError('A <note> joins a rest, and a rest cannot be part of a chord.', {
        path,
        line,
      })
    }

    // Every note of a chord belongs to one event, so they have to agree on
    // how long that event lasts.
    const chordDuration = previous.duration
    if (duration && chordDuration && compareFractions(duration, chordDuration) !== 0) {
      throw new MusicXMLError('A <note> in a chord lasts a different time from the chord.', {
        path,
        line,
      })
    }

    return { event: previous.event, start: previous.start }
  }

  /**
   * Marks this voice as a rest filling the measure, which then holds nothing
   * else: MNX states the rest on the sequence instead of as an event, so a
   * voice cannot be both.
   */
  setFullMeasure(
    voice: string | undefined,
    rest: FullMeasureRest,
    covering: Fraction | undefined,
    staff: number | undefined,
    asEvent: { event: () => Event; duration: Fraction } | undefined,
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (this.hasFullMeasure(voice)) {
      throw new MusicXMLError('A voice has more than one rest that fills the measure.', {
        path,
        line,
      })
    }
    // MNX states such a rest on the sequence, where a bracket cannot reach
    // it, so a tuplet or a tremolo open around it is its own refusal. It is
    // weighed before the content check below, because a tuplet's own item is
    // already in the content and would otherwise refuse the rest as notes
    // that are not there.
    const opened = builder.open.at(-1)
    if (opened) {
      throw new MusicXMLError(
        `A rest that fills the measure is inside ${
          opened.opened === 'tuplet' ? 'a <tuplet>' : 'a two-note tremolo'
        }. MNX states such a rest on the sequence rather than as an event, so nothing ` +
          'can hold it.',
        { path, line },
      )
    }
    if (builder.content.length > 0) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    this.#writeAt()

    // The rest is the whole of this voice in this measure, so the staff it
    // names is the staff the sequence sits on.
    builder.placed.push({ event: undefined, staff })
    builder.fullMeasure = rest
    builder.restAsEvent = asEvent && {
      ...asEvent,
      at: this.#cursor,
      after: builder.end,
      staff,
    }
    // The rest occupies the whole voice, so nothing may follow it there.
    if (covering) builder.end = addFractions(this.#cursor, covering)
  }

  /** Whether this voice's measure rest stands on the sequence rather than as an event. */
  restsMeasure(voice: string | undefined): boolean {
    return this.#builderFor(voice).fullMeasure !== undefined
  }

  /**
   * Writes this voice's measure rest back as the event its length is written
   * as, and hands back whether it could be.
   *
   * MNX states a rest filling the measure on the sequence rather than as an
   * event in it, and that sequence holds nothing else, so a grace note
   * written after such a rest has nowhere to stand. Which side of the rest
   * the grace notes are written on says nothing about the music: either way
   * the voice rests the measure and the grace notes lead into the next one.
   * A rest read before them is therefore taken back off the sequence here, so
   * that both orders convert to the same thing.
   *
   * Where no note value can write the rest, there is no event to take it back
   * as, and nothing can stand beside it.
   */
  restoreMeasureRest(voice: string | undefined, path: DocumentPath, line: number): boolean {
    const builder = this.#builderFor(voice)
    const restored = builder.restAsEvent
    if (!restored) return false

    const event = restored.event()
    // The rest is the whole of the voice, so the staff it named is the only
    // entry standing, and the event added below names it instead.
    builder.placed.length = 0
    builder.fullMeasure = undefined
    builder.restAsEvent = undefined
    // Wound back to where the voice stood before the rest was written, so
    // that silence the rest was written after is stated as a space, as it
    // would have been for a rest that never left the content.
    builder.end = restored.after

    // Written where the rest stands rather than where the cursor has since
    // reached, which is past the rest: a <forward> or the rest's own length
    // moved it there.
    const reached = this.#cursor
    this.#cursor = restored.at
    this.addEvent(voice, event, restored.duration, path, line, restored.staff)
    builder.restsMeasureAsEvent = true
    this.#moveTo(reached)
    return true
  }

  /**
   * Adds a rest filling the measure as an event, which then holds nothing
   * else. Grace notes before it take none of the measure's time, so they are
   * the only thing it can follow.
   */
  addMeasureRestEvent(
    voice: string | undefined,
    event: Event,
    duration: Fraction,
    path: DocumentPath,
    line: number,
    staff: number | undefined,
  ): PlacedEvent {
    const builder = this.#builderFor(voice)
    if (builder.content.some((item) => item.kind !== 'grace')) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }
    const placed = this.addEvent(voice, event, duration, path, line, staff)
    builder.restsMeasureAsEvent = true
    return placed
  }

  /**
   * Starts the tuplets a note opens in this voice, outermost first. Notes
   * added after them go inside, until each is closed. `inner` and `outer` are
   * the note's cumulative <time-modification>; each level's own share is
   * settled by `tupletLevels`.
   */
  openTuplets(
    voice: string | undefined,
    inner: NoteValueQuantity,
    outer: NoteValueQuantity,
    starts: readonly TupletStart[],
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
    /**
     * True where the ratio was read from the note rather than stated by a
     * <time-modification>. Such a ratio speaks for that one note, so the
     * multiples are scaled to what the bracket holds once it closes.
     */
    derived: boolean,
  ): void {
    const builder = this.#builderFor(voice)
    // A tremolo holds exactly its two notes, so no bracket may open inside
    // one.
    if (tremoloFrame(builder)) {
      throw new MusicXMLError('A tuplet starts inside a two-note tremolo.', { path, line })
    }

    const levels = tupletLevels(
      tupletFrames(builder).map((open) => open.ratio),
      inner,
      outer,
      starts,
      warnings,
      context,
      line,
    )

    // Time this voice has passed over in silence belongs before the brackets,
    // not inside them, where the tuplets' ratios would scale it.
    this.#fillGap(builder)
    // Where this voice has reached, before anything the brackets hold. A
    // bracket that states no ratio compares it with where the voice reaches
    // when it closes, to state the time it took.
    const openEnd = builder.end
    for (const [index, level] of levels.entries()) {
      const { display } = level
      const content: SequenceItem[] = []
      // A setting the source states is set; one it does not is left off the
      // tuplet, rather than set to undefined, because MNX reads an absent
      // key as the renderer's choice. Written as assignments rather than as
      // conditional spreads so that the compiler holds the difference: a
      // spread of { bracket: undefined } into a tuplet type-checks, and each
      // of these four did.
      const tuplet: Draft<Tuplet> = {
        kind: 'tuplet',
        inner: level.inner,
        outer: level.outer,
        content,
      }
      if (display.bracket !== undefined) tuplet.bracket = display.bracket
      if (display.showNumber !== undefined) tuplet.showNumber = display.showNumber
      if (display.showValue !== undefined) tuplet.showValue = display.showValue
      if (display.orient !== undefined) tuplet.orient = display.orient

      const within = innermost(builder)
      within.push(tuplet)
      builder.open.push({
        opened: 'tuplet',
        list: content,
        tuplet,
        ratio: ratioOf(level.inner, level.outer),
        number: level.number,
        // A level whose own marker stated its ratio states it already, and
        // rescaling that to the content would overwrite what the source drew.
        derived: derived && starts[index]?.stated === undefined,
        stated:
          starts[index]?.stated !== undefined || (!derived && levels.length === 1)
            ? { inner: level.inner, outer: level.outer }
            : undefined,
        openEnd,
        unbracketed: false,
        within,
        children: [],
        skips: [],
      })
    }
  }

  /**
   * Starts a tuplet the source stated as a ratio with no bracket around it.
   * Opened only where nothing else is, so it is always the one frame this
   * voice is inside.
   */
  openImpliedTuplet(
    voice: string | undefined,
    inner: NoteValueQuantity,
    outer: NoteValueQuantity,
  ): void {
    const builder = this.#builderFor(voice)
    // Time this voice passed over in silence belongs before the tuplet, not
    // inside it, where the ratio would scale it.
    this.#fillGap(builder)

    const content: SequenceItem[] = []
    const tuplet: Draft<Tuplet> = { kind: 'tuplet', inner, outer, content }
    const within = innermost(builder)
    within.push(tuplet)
    builder.open.push({
      opened: 'tuplet',
      list: content,
      tuplet,
      ratio: ratioOf(inner, outer),
      // No marker numbered it, and no stop of its own closes it.
      number: '1',
      derived: false,
      // The notes state the ratio; where the run ends is the converter's
      // reading of where they stop agreeing with it.
      stated: undefined,
      openEnd: builder.end,
      unbracketed: true,
      within,
      children: [],
      skips: [],
    })
  }

  /** Whether this voice is inside a tuplet stated as a ratio with no bracket. */
  insideImpliedTuplet(voice: string | undefined): boolean {
    return impliedFrame(this.#builderFor(voice)) !== undefined
  }

  /** Whether a two-note tremolo is open in this voice. */
  insideTremolo(voice: string | undefined): boolean {
    return tremoloFrame(this.#builderFor(voice)) !== undefined
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice ends at time the
   * voice has passed over in silence. A skip inside such a run stands in it
   * as a space, the way a rest written there would, so a skip the ratio still
   * counts room for leaves the run open. One that carries the run past what
   * its ratio counts cannot be inside it, because the run is gathered from
   * what follows the ratio and nothing the source drew bounds it. False where
   * no such tuplet is open.
   */
  impliedTupletEndsAtGap(voice: string | undefined): boolean {
    const builder = this.#builderFor(voice)
    const open = impliedFrame(builder)
    if (!open) return false
    const gap = subtractFractions(this.#cursor, builder.end)
    if (compareFractions(gap, fraction(0)) <= 0) return false
    // Stated in the run's written units, as everything inside it is.
    const held = addFractions(
      writtenLengthOf(open.tuplet.content),
      divideFractions(gap, tupletFactorOf(builder)),
    )
    return compareFractions(held, countedLengthOf(open)) > 0
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice ends before a note
   * stating `quantities`. It takes the note while the note states the same
   * counts and the tuplet holds less than what its first note's ratio counts.
   * False where no such tuplet is open.
   */
  impliedTupletEndsBefore(
    voice: string | undefined,
    quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined,
  ): boolean {
    const open = impliedFrame(this.#builderFor(voice))
    if (!open) return false
    if (this.impliedTupletEndsAtGap(voice)) return true
    if (!quantities) return true
    return !sameCounts(open.tuplet, quantities) || tupletFilled(open)
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice holds all its
   * ratio counts, so a stop marker written here agrees with where the ratio
   * ends it. False where no such tuplet is open.
   */
  impliedTupletFilled(voice: string | undefined): boolean {
    const open = impliedFrame(this.#builderFor(voice))
    return open !== undefined && tupletFilled(open)
  }

  /**
   * Closes the measure once every element of it is read, running the passes
   * that wait for the measure to be whole in the order each needs the one
   * before it.
   *
   * Tuplets close first: what a bracket writes turns on what it holds, on the
   * frame the brackets around it write in, and on the silence after it. Then
   * every event of the measure is in, so a hairpin's and an octave shift's
   * stop can each be told which one it covers, whatever order the source
   * wrote them in. Then a rest standing as the whole of its voice is read as
   * that voice's measure rest, after the covers, which read the rest while it
   * is still an event.
   */
  finish(
    opening: Omit<MeasureExtent, 'length'>,
    settleSpanCovers: (
      lastEventBefore: (position: Fraction, staff?: number) => CoveredEvent | undefined,
      graceNotesAt: (position: Fraction, staff?: number) => number,
    ) => void,
    /** The components this part strikes, which is where a kit note's height is. */
    kit: ReadonlyMap<string, KitComponent>,
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
  ): FinishedMeasure {
    // A tuplet the source stated as a ratio with no bracket has no stop to
    // close it, so the measure's end is where its run ends.
    this.#closeImpliedTuplets(warnings, context, path, line)
    const carriedTupletStops = this.#closeAtBarline(warnings, context, path, line)

    // A pickup measure's beats line up with the barline it ends on, and it
    // has no silence past its own end.
    const furthest = this.furthest()
    const { anchor, signature } = opening
    const length =
      anchor === 'start' && signature && compareFractions(signature, furthest) > 0
        ? signature
        : furthest
    this.#settleMeasure({ anchor, length, signature }, warnings, context)

    settleSpanCovers(
      (position, staff) => this.#lastEventBefore(position, staff),
      (position, staff) => this.graceNotesAt(position, staff),
    )
    this.#settleMeasureRests()

    return {
      beamedEvents: this.#beamedEvents(),
      arpeggios: this.#settleArpeggios(warnings, context, kit),
      sequences: this.#sequences(warnings, context),
      carriedTupletStops,
    }
  }

  /**
   * Closes any tuplet the ratio alone opened, in every voice. A run of such
   * notes ends where the measure does, whether or not it filled its ratio.
   */
  #closeImpliedTuplets(
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
  ): void {
    for (const builder of this.#allBuilders()) {
      const open = impliedFrame(builder)
      if (open) this.#closeTuplet(builder, open, warnings, context, path, line, false)
    }
  }

  /**
   * How much of its written value a note in this voice really lasts, given
   * every tuplet currently open around it: 2/3 inside a triplet, and the
   * ratios multiply where tuplets nest. Inside a two-note tremolo each note
   * is written with the value of the pair, so it lasts half of it.
   */
  tupletFactor(voice: string | undefined): Fraction {
    const builder = this.#builderFor(voice)
    const factor = tupletFactorOf(builder)
    return tremoloFrame(builder) ? multiplyFractions(factor, fraction(1, 2)) : factor
  }

  /**
   * What is open around a note in this voice scaling its written value, for a
   * report to name. The tremolo is the nearer of the two where both are open,
   * since no bracket opens inside one.
   */
  scaledBy(voice: string | undefined): 'tuplet' | 'tremolo' | undefined {
    const builder = this.#builderFor(voice)
    if (tremoloFrame(builder)) return 'tremolo'
    return tupletFrames(builder).length > 0 ? 'tuplet' : undefined
  }

  /**
   * Starts a two-note tremolo in this voice. The notes added while it is
   * open are gathered, and join the content as one item when it closes.
   */
  openTremolo(voice: string | undefined, marks: number, path: DocumentPath, line: number): void {
    const builder = this.#builderFor(voice)
    if (tremoloFrame(builder)) {
      throw new MusicXMLError('A tremolo starts inside another tremolo.', { path, line })
    }

    // Time this voice has passed over in silence belongs before the tremolo.
    this.#fillGap(builder)
    builder.open.push({ opened: 'tremolo', list: [], marks, durations: [] })
  }

  /**
   * Closes the tremolo: exactly two notes of one written value, together
   * occupying twice their measured duration. Anything else is a tremolo this
   * converter cannot make sense of, and refusing is better than emitting a
   * measure that does not add up.
   */
  closeTremolo(
    voice: string | undefined,
    marks: number,
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    const pending = tremoloFrame(builder)
    if (!pending) {
      throw new MusicXMLError('A tremolo stops where none is open.', { path, line })
    }

    // Both ends count the beams joining the pair, and there is one pair to
    // draw.
    if (marks !== pending.marks) {
      warnings.add(
        'inconsistent:tremolo',
        'The two ends of a tremolo count different beams. The count where it starts ' +
          'is the one converted.',
        { ...context, line },
        'tremolo',
      )
    }

    // With no bracket able to open inside a tremolo, its frame is on top
    // whenever one is open.
    builder.open.pop()

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
    const unit = noteValueOf(divideFractions(first, tupletFactorOf(builder)))
    if (!unit) {
      throw new MusicXMLError(
        `A note of a tremolo lasts ${describeLength(first)}, which no note value can write.`,
        { path, line },
      )
    }

    innermost(builder).push({
      kind: 'multiNoteTremolo',
      marks: pending.marks,
      outer: { value: unit, multiple: 2 },
      content: events,
    })
  }

  /** Records what an event said about the beams it carries. */
  addBeamMarkers(
    voice: string | undefined,
    id: string,
    markers: ReadonlyMap<number, string>,
    beamCount: number,
    /** Whether the event is a grace note, whose beams run within its group. */
    inGraceGroup: boolean,
  ): void {
    if (markers.size === 0) return
    const builder = this.#builderFor(voice)
    if (!inGraceGroup) {
      builder.beamed.push({ id, markers, beamCount })
      return
    }
    const run = builder.graceBeamed.at(-1)
    /* v8 ignore next -- a grace note joins its group before its beams are
       read, so a run is always open by the time this is reached. */
    if (!run) throw new Error('A grace note has no group to beam within.')
    run.push({ id, markers, beamCount })
  }

  /**
   * Marks the event a note just joined as rolled, or as struck together. Both
   * are drawn beside the chord rather than on one of its notes, so MNX states
   * them on the measure, spanning the notes they run between.
   */
  markArpeggio(
    { event, start: position }: PlacedEvent,
    /** The note the mark was written on, or nothing where a rest carried it. */
    note: Note | undefined,
    number: string | undefined,
    struck: boolean,
    direction: 'up' | 'down' | undefined,
    arrow: boolean,
    /** The line the mark is written on, for the report that comes later. */
    line: number,
  ): void {
    // Every note of a chord carries the mark, so the first one to arrive sets
    // it up and the rest join what it already covers. Marks on one chord are
    // that chord's own roll however the source numbers them: sources number
    // one note and leave the next bare, and taking those apart drew the roll
    // twice. Only two stated numbers that differ are two rolls.
    const existing = this.#arpeggios.find(
      (found) =>
        found.event === event &&
        (found.number === undefined || number === undefined || found.number === number),
    )
    if (existing) {
      if (note) existing.notes.push(note)
      // A stated number claims a join with another chord's mark, so it stands
      // where the mark it joins stated none.
      existing.number ??= number
      // One roll cannot go both ways, so a second direction is a loss rather
      // than a detail: the first stands and the other is reported.
      existing.crossed ||=
        existing.direction !== undefined &&
        direction !== undefined &&
        existing.direction !== direction
      existing.direction ??= direction
      existing.arrow ||= arrow
      // Rolled and struck together are opposite instructions.
      existing.conflicted ||= existing.struck !== struck
      return
    }

    this.#arpeggios.push({
      event,
      notes: note ? [note] : [],
      position,
      number,
      struck,
      line,
      conflicted: false,
      crossed: false,
      direction,
      arrow,
    })
  }

  /**
   * The rolled and struck chords of the measure.
   *
   * Marks sounding at the same point under the same number are one roll,
   * across however many chords carry them, so they are gathered before the
   * span is worked out. The span names the first-played note first, which for
   * a roll going downwards is the highest.
   *
   * A mark stating no number is gathered by the event it sits on instead, so
   * it joins the rest of its own chord and nothing beyond it. By the event
   * rather than by where it sits: a grace chord takes no time, so it begins
   * where the chord it decorates does, and the two are still two chords.
   */
  #settleArpeggios(
    warnings: WarningCollector,
    context: WarningContext,
    /** The components this part strikes, which is where a kit note's height is. */
    kit: ReadonlyMap<string, KitComponent>,
  ): Arpeggio[] {
    // Marks on one chord are weighed together first, whatever they are
    // numbered. Numbering them differently otherwise put them in groups that
    // could not see each other, and a chord marked rolled by one and struck
    // by the other came out as both, drawn over the same notes.
    const kept: MarkedArpeggio[] = []
    for (const marked of this.#arpeggios) {
      const first = kept.find((one) => one.event === marked.event)
      if (first && first.struck !== marked.struck) {
        warnings.add(
          'unrepresentable:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          { ...context, line: first.line },
          'arpeggiate',
        )
        continue
      }
      kept.push(marked)
    }

    // A chord whose notes are numbered two different ways is two rolls, each
    // over the notes that carried its own mark: a pianist rolls the lower
    // half and the upper half apart. Marked once, the chord is what the roll
    // spans, because the roll is drawn beside the whole chord and sources
    // mark one note of it and leave the rest bare.
    const seen = new Set<Event>()
    const divided = new Set<Event>()
    for (const one of kept) {
      if (seen.has(one.event)) divided.add(one.event)
      seen.add(one.event)
    }

    const groups = new Map<string, MarkedArpeggio[]>()
    for (const marked of kept) {
      const key =
        marked.number === undefined
          ? `event ${marked.event.id}`
          : `${String(marked.position.num)}/${String(marked.position.den)}|number ${marked.number}`
      groups.set(key, [...(groups.get(key) ?? []), marked])
    }

    const arpeggios: Arpeggio[] = []
    for (const group of groups.values()) {
      const first = group[0]
      /* v8 ignore next -- a group exists because something was put in it. */
      if (!first) continue

      const notes = group.flatMap((one) => (divided.has(one.event) ? one.notes : one.event.notes))
      const kitNotes = group.flatMap((one) => one.event.kitNotes)
      // A chord struck on a percussion kit carries no pitches to order by, so
      // it is ordered by the height the part's kit draws each component at. A
      // mark is written on a note and a kit note carries none, so such a roll
      // spans the whole chord.
      const ordered: readonly TieTarget[] =
        notes.length > 0
          ? [...notes].sort((a, b) => staffOrder(a.pitch) - staffOrder(b.pitch))
          : kitOrder(kitNotes, kit)

      if (ordered.length === 0) {
        // MNX states a roll as the two notes it runs between, and there are
        // none to name.
        warnings.add(
          'unsupported:element',
          'A rest is marked as rolled, and a roll runs between notes, so it is not ' +
            'carried over.',
          { ...context, line: first.line },
          'arpeggiate',
        )
        continue
      }

      // A struck bracket runs between its bottom and top ends, each written
      // on its own note. A lone marker with one note under it is half a
      // bracket: written out, it would span the note to itself.
      if (first.struck && ordered.length === 1) {
        warnings.add(
          'unclosed:spanner',
          'A bracket marking notes as struck together has only one note under it, ' +
            'and is not carried over.',
          { ...context, line: first.line },
          'non-arpeggiate',
        )
        continue
      }

      // A chord sounding on a pitched staff and a kit at once is spanned by
      // its pitched notes: a diatonic index and a staff height do not
      // compare, and ordering the two together would mean reading each pitch
      // against the clef drawing it. MNX reads the notes a mark covers as the
      // ones whose pitch lies between its ends, so a kit note left out of the
      // span is left out of the mark. Reported here rather than above, where
      // the mark may still turn out not to be carried at all.
      if (notes.length > 0 && kitNotes.length > 0) {
        warnings.add(
          'unsupported:element',
          `A chord ${first.struck ? 'bracketed as struck together' : 'rolled'} across a ` +
            'pitched staff and a percussion kit is carried over its pitched notes only, ' +
            'which is not the whole chord.',
          { ...context, line: first.line },
          first.struck ? 'non-arpeggiate' : 'arpeggiate',
        )
      }

      // Marks numbered two ways divide a chord into two, each over the notes
      // that carried its own mark. A mark is written on a note and a kit note
      // carries none, so which of them each number covers is not known, and
      // both come out over the whole chord.
      if (notes.length === 0 && group.some((one) => divided.has(one.event))) {
        warnings.add(
          'unsupported:element',
          'A chord struck on a percussion kit is marked twice under different numbers, ' +
            'and which notes each covers is not known. Each is carried over the whole ' +
            'chord.',
          { ...context, line: first.line },
          first.struck ? 'non-arpeggiate' : 'arpeggiate',
        )
      }

      if (group.some((one) => one.crossed)) {
        warnings.add(
          'inconsistent:arpeggio',
          'A chord is rolled upwards by one mark and downwards by another. The first ' +
            'is the one converted.',
          { ...context, line: first.line },
          'arpeggiate',
        )
      }

      if (group.some((one) => one.conflicted || one.struck !== first.struck)) {
        warnings.add(
          'unrepresentable:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          { ...context, line: first.line },
          'arpeggiate',
        )
      }

      const lowest = ordered[0]
      const highest = ordered.at(-1)
      /* v8 ignore next -- the list is not empty, so it has both ends. */
      if (!lowest || !highest) continue

      // MusicXML rolls from the lowest note up unless it says otherwise.
      const direction = first.direction ?? 'up'
      arpeggios.push({
        position: first.position,
        span:
          direction === 'down'
            ? { start: highest.id, end: lowest.id }
            : { start: lowest.id, end: highest.id },
        direction,
        arrow: first.arrow,
        struck: first.struck,
      })
    }
    return arpeggios
  }

  /** What every voice said about its beams, voice by voice. */
  #beamedEvents(): BeamedEvent[][] {
    const builders = this.#allBuilders()
    return [...builders.map((b) => b.beamed), ...builders.flatMap((b) => b.graceBeamed)]
  }

  /** Whether a tuplet or a tremolo is open around a note in this voice. */
  insideBracket(voice: string | undefined): boolean {
    return this.#builderFor(voice).open.length > 0
  }

  /**
   * The voice the chord being built belongs to. A chord member may leave
   * <voice> off, and Sibelius does, so it belongs to the event it joins
   * rather than to the unnamed voice.
   */
  voiceOfChord(voice: string | undefined): string | undefined {
    return voice ?? this.#lastVoice
  }

  /** Holds what the event's own note said about tuplets, for its chord. */
  noteTupletMarkers(voice: string | undefined, markers: readonly string[]): void {
    this.#builderFor(voice).eventTupletMarkers = markers
  }

  /**
   * Whether a chord member's marker restates one the chord's own note
   * carried. Every note of a chord is written with the bracket around the
   * chord, and that bracket is one bracket.
   */
  restatesTupletMarker(voice: string | undefined, marker: string): boolean {
    return this.#builderFor(voice).eventTupletMarkers.includes(marker)
  }

  /**
   * Records a tuplet this voice never opened, by the number its start marker
   * stated, so the stop that matches it can be dropped with it.
   */
  dropTupletStart(voice: string | undefined, number: string): void {
    this.#builderFor(voice).droppedTuplets.push(number)
  }

  /**
   * Whether this stop closes a tuplet there is no bracket of its own to close:
   * one whose start was dropped where it could not be drawn, or one an earlier
   * measure closed at its barline. A bracket of that number standing open is
   * what the stop closes instead: the source numbers every tuplet 1 unless it
   * nests them, so a dropped start and an open bracket share a number as a
   * matter of course, and taking the stop from the open bracket would leave it
   * open to the end of the measure.
   *
   * The record is consumed, so a second stop stating the number closes an
   * open bracket as any other stop does.
   */
  closesDroppedTuplet(voice: string | undefined, number: string): boolean {
    const builder = this.#builderFor(voice)
    if (tupletFrames(builder).some((open) => open.number === number)) return false

    const at = builder.droppedTuplets.lastIndexOf(number)
    if (at >= 0) {
      builder.droppedTuplets.splice(at, 1)
      return true
    }

    // A stop written inside a bracket the source drew names that bracket,
    // however the source numbers the two, so a carried stop is taken only
    // where this voice has no such bracket open, in any of its lines. A run
    // the ratio alone opened is not one: the source drew no bracket for it,
    // and it ends by its own count rather than on a stop.
    //
    // The test matters twice over. A bracket cut at a barline is usually
    // carried on by notes that state the same ratio, which opens such a run,
    // so without it the stop that ends the source's bracket closes the run
    // instead and the record of the cut bracket is left standing for the rest
    // of the part, to swallow some later stop that means something else.
    const drawn = this.#layersFor(voice).layers.some((layer) =>
      tupletFrames(layer).some((open) => !open.unbracketed),
    )
    if (drawn) return false

    const carried = this.#carriedStops.findIndex(
      (one) => one.voice === (voice ?? UNNAMED_VOICE) && one.number === number,
    )
    if (carried < 0) return false

    this.#carriedStops.splice(carried, 1)
    return true
  }

  /**
   * Closes the innermost open tuplet in this voice, handing back the number
   * its start marker stated so the caller can weigh the note's stops as a
   * batch: which stop is written first on a note is not constrained, so a
   * crossing shows only when the note's stated numbers and the closed ones
   * disagree as sets.
   */
  closeTuplet(
    voice: string | undefined,
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
  ): string | undefined {
    const builder = this.#builderFor(voice)
    const closed = builder.open.at(-1)
    // A stop naming a bracket this voice never opened. A bracket whose start
    // was dropped and one an earlier measure closed at its barline are both
    // answered for already, so what is left is a marker the source wrote
    // where nothing of its can end. It takes none of the measure's time, so
    // the measure still adds up without it.
    if (!closed) {
      warnings.add(
        'inconsistent:tuplet',
        'A <tuplet> stops where no tuplet is open, and names no bracket this measure ' +
          'dropped or carried in. The marker is passed over.',
        { ...context, line },
        'tuplet',
      )
      return undefined
    }
    return this.#closeTuplet(builder, closed, warnings, context, path, line, false)
  }

  /**
   * The same, for a voice and its innermost frame already in hand. `cut`
   * marks a close the barline forced rather than a stop the source wrote, so
   * the bracket holding less than its ratio counts is the converter's doing
   * and is not reported again.
   */
  #closeTuplet(
    builder: VoiceBuilder,
    closed: OpenBracket,
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
    cut: boolean,
  ): string {
    // A tremolo edge and a tuplet edge can land on different notes. Popping
    // the tremolo's frame here would lose the notes it holds, so a bracket
    // closing across an open tremolo refuses instead.
    if (closed.opened === 'tremolo') {
      throw new MusicXMLError('A tuplet closes inside a two-note tremolo.', { path, line })
    }
    builder.open.pop()

    const { tuplet } = closed
    // A run the ratio alone opened on a note that turned out not to be an
    // event holds nothing. It stands for no tuplet the source wrote, so it
    // goes rather than being drawn empty. Such a run opens only where no other
    // bracket is, and everything written while it is open lands inside it, so
    // it is the last item this voice holds.
    if (closed.unbracketed && tuplet.content.length === 0) {
      builder.content.pop()
      return closed.number
    }
    // A bracket that holds nothing taking any of the measure's time, which is
    // what a bracket opening and closing on grace notes holds. MNX states a
    // tuplet as a written length against the time it is played in, and a
    // grace note gives neither, so there is no tuplet to write.
    if (writtenLengthOf(tuplet.content).num === 0) {
      unwrapTuplet(closed.within, tuplet)
      warnings.add(
        'unrepresentable:tuplet-untimed',
        "A tuplet bracket holds nothing that takes any of the measure's time, as a bracket " +
          'over grace notes alone does. MNX states a tuplet as a written length against the ' +
          'time it is played in, so the bracket is not converted and what it holds is ' +
          'written as it stands.',
        { ...context, line },
        'tuplet',
      )
      return closed.number
    }
    // Real scores contain brackets whose content does not add up to the
    // stated ratio: a lone quarter under a 3:2 eighth ratio, standing for a
    // triplet quarter. MNX sequences a tuplet by advancing the cursor over
    // its outer and requires the content to come to inner, so such a bracket
    // is rewritten to count the notes it holds, which leaves them sounding
    // for the time the source gives them. Which reading it takes is settled
    // once the measure is whole: what the bracket holds, the frame the
    // brackets around it write in and the silence after it are none of them
    // known here.
    const claim: TupletClaim = {
      tuplet,
      within: closed.within,
      stated: closed.stated,
      derived: closed.derived,
      unbracketed: closed.unbracketed,
      cut,
      openEnd: closed.openEnd,
      spent: subtractFractions(builder.end, closed.openEnd),
      frame: tupletFactorOf(builder),
      children: closed.children,
      skips: closed.skips,
      place: warnings.reserve(),
      line,
    }
    // A bracket still open around this one holds the claim, so that the two
    // settle together: this one's outer is written in the frame that one
    // ends up with.
    const around = tupletFrames(builder).at(-1)
    if (around) around.children.push(claim)
    else builder.claims.push(claim)

    return closed.number
  }

  /**
   * Adds a grace note, which takes none of the measure's time. Consecutive
   * grace notes gather into one group, as they are played and drawn, unless
   * they take their time from different sides.
   */
  addGraceNote(
    voice: string | undefined,
    event: Event,
    slashed: boolean,
    graceType: GraceType | undefined,
    staff?: number,
  ): PlacedEvent {
    const builder = this.#builderFor(voice)
    this.#writeAt()
    // A grace note is squeezed in before the note it ornaments, so time the
    // voice has passed over in silence is passed over before the group rather
    // than after it. Filling the gap here keeps the group beside its note
    // instead of stranding it at the point the voice last sounded.
    this.#fillGap(builder)

    const list = innermost(builder)
    const previous = list.at(-1)

    this.#lastVoice = voice ?? UNNAMED_VOICE
    // Grace notes have no duration of their own, so a chord note joining one
    // has nothing to agree with.
    const start = this.#cursor
    builder.last = { event, duration: undefined, start }
    this.#eventStarts.push({ start, staff, grace: true })
    // Recorded like any other event, so the voice's staff counts it and a
    // grace note reaching across to the other staff says so.
    builder.placed.push({ event, staff })

    // Grace notes running together are one group, unless they take their time
    // from different sides. MusicXML tells an after-grace from the graces
    // leading into the next note by that alone: both are written as a run of
    // <grace> notes between the two, and only steal-time-previous says the
    // first belongs to the note before. MNX states one side per group, so the
    // run is cut where the side changes. A note naming no side joins whatever
    // is open.
    if (
      previous?.kind === 'grace' &&
      (graceType === undefined ||
        previous.graceType === undefined ||
        previous.graceType === graceType)
    ) {
      previous.content = [...previous.content, event]
      if (slashed) previous.slashed = true
      previous.graceType ??= graceType
      return { event, start }
    }

    const group: GraceGroup = { kind: 'grace', content: [event], slashed, graceType }
    list.push(group)
    // Each group beams within itself, so each starts a run of its own.
    const beams: BeamedEvent[] = []
    builder.graceBeamed.push(beams)
    // Held until the note it leads into says which sequence it is in. Its
    // own entry in `placed` is the one just pushed.
    builder.grace = { group, beams, at: start, placedFrom: builder.placed.length - 1 }
    return { event, start }
  }

  /**
   * Marks the rest just added as one that could be this voice's measure rest,
   * to be settled by settleMeasureRests once the voice is whole.
   */
  markMeasureRest(voice: string | undefined, event: Event, reportMismatch: () => void): void {
    this.#builderFor(voice).measureRest = { event, reportMismatch }
  }

  /**
   * Reads a rest that is the whole of its voice as that voice's measure rest.
   *
   * A bar of silence is drawn with a whole rest whatever the meter says, so a
   * 3/2 measure rests with a whole rest lasting a dotted whole. Where the
   * exporter leaves measure="yes" off, taking the written value as the rest's
   * length leaves the measure short. MNX has the full-measure rest's
   * visualDuration for exactly this: the rest lasts the measure, and the
   * value drawn is stated beside it.
   *
   * Settled here rather than at the note, because a rest lasting exactly the
   * measure is not the measure's rest wherever it stands: sources write one
   * beside other notes, and the voice has to be whole before the two can be
   * told apart.
   *
   * Anything reaching the rest keeps it an ordinary event. MNX states a
   * measure rest on the sequence, which carries no marking, no stem, no beam
   * and no roll, and has no id for a slur or a lyric to reach.
   */
  #settleMeasureRests(): void {
    for (const builder of this.#allBuilders()) {
      const candidate = builder.measureRest
      if (!candidate) continue

      const { event } = candidate
      const reached =
        builder.beamed.length > 0 ||
        event.stemDirection !== undefined ||
        event.lyrics.size > 0 ||
        Object.keys(event.markings).length > 0 ||
        this.#arpeggios.some((marked) => marked.event === event)
      if (reached || builder.content.length !== 1 || builder.content[0] !== event) {
        candidate.reportMismatch()
        continue
      }

      // The rest is the whole of the voice, so the staff it named stays as
      // the sequence's own. Its entry keeps naming the event it came from,
      // which nothing writes once the content is empty.
      builder.content.length = 0
      builder.fullMeasure = {
        visualDuration: event.value,
        fermata: event.fermata,
        staffPosition: event.staffPosition,
      }
    }
  }

  /**
   * Settles what the measure leaves open at its barline, and hands back the
   * stops the measures after it will meet with nothing to close.
   *
   * A tremolo holds exactly its two notes, so one left open is a source the
   * reader can make no sense of and the document is refused.
   *
   * A <tuplet> bracket may start in one measure and stop in the next, and MNX
   * states a tuplet inside one measure's sequence, so a bracket still open
   * here is closed at the barline and the loss reported.
   *
   * A stop carried in and not met here is handed on with them. The source may
   * write it any number of measures later, and a stop that closes nothing is
   * passed over rather than refusing the file, as one whose start was dropped
   * already is.
   */
  #closeAtBarline(
    warnings: WarningCollector,
    context: WarningContext,
    path: DocumentPath,
    line: number,
  ): CarriedTupletStop[] {
    const carried = [...this.#carriedStops]
    for (const [voice, layers] of this.#voices) {
      for (const builder of layers.layers) {
        if (tremoloFrame(builder)) {
          throw new MusicXMLError('A tremolo is opened and never closed.', { path, line })
        }
        for (let open = builder.open.at(-1); open; open = builder.open.at(-1)) {
          warnings.add(
            'unrepresentable:tuplet-span',
            'A tuplet bracket runs past the end of the measure, and MNX states a tuplet ' +
              'inside one measure. It is drawn as far as the barline, over the notes of ' +
              'it that this measure holds.',
            { ...context, line },
            'tuplet',
          )
          carried.push({
            voice,
            number: this.#closeTuplet(builder, open, warnings, context, path, line, true),
          })
        }
      }
    }
    return carried
  }

  /**
   * The sequences, in the order their voices first appeared.
   *
   * A voice belongs to the staff it spends most of its time on, and only the
   * events that reach across to another say so. Choosing the commonest that
   * way keeps the overrides to the notes that genuinely cross.
   */
  #sequences(warnings: WarningCollector, context: WarningContext): Sequence[] {
    // A note that names no voice lands in its own bucket. Beside notes that do
    // name a voice, that splits one measure into two lines with no way to know
    // the source meant them apart, so the split is reported rather than silent.
    if (this.#voices.size > 1 && this.#voices.has(UNNAMED_VOICE)) {
      warnings.add(
        'missing:voice',
        'A note names no voice while others in the measure do. It is kept as a ' + 'separate line.',
        context,
        'note',
      )
    }

    // A line opened for a note that was then dropped holds nothing, and a
    // sequence stating nothing is not a line the source drew. The voice's
    // first line stays whatever it holds, so a voice that wrote nothing is
    // the one empty sequence it always was.
    const sounding = new Map(
      [...this.#voices].map(([voice, layers]) => [
        voice,
        layers.layers.filter(
          (builder, index) =>
            index === 0 || builder.content.length > 0 || builder.fullMeasure !== undefined,
        ),
      ]),
    )

    for (const [voice, layers] of sounding) {
      // Undefined for a voice that sounds one line, which is the voice's
      // first and was opened by nothing.
      const openedAt = layers[1]?.openedAt
      if (openedAt === undefined) continue
      warnings.add(
        'inconsistent:voice',
        `Voice ${voice === UNNAMED_VOICE ? '(unnamed)' : voice} sounds ` +
          `${String(layers.length)} lines at once in this measure. Each is kept as a ` +
          'separate sequence.',
        { ...context, line: openedAt },
        'note',
      )
    }

    // MNX lets no two sequences of a measure share a voice name, and a line
    // laid over a voice has none of its own: the source named one voice for
    // both. Naming both by it would state that two lines are one, and
    // leaving every laid-over line unnamed leaves two of them in a measure
    // that nothing can tell apart. Each takes a name of its own, built from
    // the voice it was laid over and the line it is, and stepped on past any
    // name the measure already uses.
    const taken = new Set(this.#voices.keys())
    const nameFor = (voice: string, index: number): string => {
      const base = voice === UNNAMED_VOICE ? '' : voice
      let line = index + 1
      while (taken.has(`${base}.${String(line)}`)) line += 1
      const name = `${base}.${String(line)}`
      taken.add(name)
      return name
    }

    return [...sounding].flatMap(([voice, layers]) =>
      layers.map((builder, index) => {
        const staff = commonestStaff(builder.placed.map((placed) => placed.staff))

        // Only the events that reach across to another staff say so.
        for (const placed of builder.placed) {
          if (placed.event && placed.staff !== undefined && placed.staff !== staff) {
            placed.event.staff = placed.staff
          }
        }

        return {
          staff,
          // Whenever the source named the voice. MNX treats the name as a label
          // for the line across the whole score, so deciding it per measure would
          // give one musical line a different identity from bar to bar.
          voice: index > 0 ? nameFor(voice, index) : voice === UNNAMED_VOICE ? undefined : voice,
          content: builder.content,
          fullMeasure: builder.fullMeasure,
        }
      }),
    )
  }

  /** The sequence of this voice that what comes next is written in. */
  #builderFor(voice: string | undefined): VoiceBuilder {
    const layers = this.#layersFor(voice)
    return layers.layers[layers.active] as VoiceBuilder
  }

  #layersFor(voice: string | undefined): VoiceLayers {
    const key = voice ?? UNNAMED_VOICE
    const existing = this.#voices.get(key)
    if (existing) return existing

    const created: VoiceLayers = { layers: [newVoiceBuilder()], active: 0 }
    this.#voices.set(key, created)
    return created
  }

  /**
   * The sequence of this voice with room at the cursor, made active.
   *
   * The one the voice last sounded in is preferred wherever it has room, so
   * that a run written as one run stays in one sequence: a beam, a bracket
   * or a chord split between two sequences is drawn as neither. Where it is
   * still sounding, the first sequence with room takes the note, and a new
   * one opens where every sequence is still sounding.
   */
  #layerAt(voice: string | undefined, line: number): VoiceBuilder {
    const layers = this.#layersFor(voice)
    const free = (candidate: VoiceBuilder) => compareFractions(this.#cursor, candidate.end) >= 0

    let index = free(layers.layers[layers.active] as VoiceBuilder)
      ? layers.active
      : layers.layers.findIndex(free)
    if (index === -1) {
      index = layers.layers.length
      layers.layers.push(newVoiceBuilder(line))
    }
    layers.active = index
    return layers.layers[index] as VoiceBuilder
  }

  /** Every sequence of every voice, voice by voice. */
  #allBuilders(): VoiceBuilder[] {
    return [...this.#voices.values()].flatMap((layers) => layers.layers)
  }
}

function newVoiceBuilder(openedAt?: number): VoiceBuilder {
  return {
    openedAt,
    beamed: [],
    graceBeamed: [],
    placed: [],
    open: [],
    droppedTuplets: [],
    eventTupletMarkers: [],
    content: [],
    end: fraction(0),
    last: undefined,
    grace: undefined,
    fullMeasure: undefined,
    restsMeasureAsEvent: false,
    restAsEvent: undefined,
    measureRest: undefined,
    claims: [],
    spent: new Map(),
  }
}
