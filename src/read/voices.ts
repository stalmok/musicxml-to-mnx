// Turning MusicXML's one stream per measure into MNX's one sequence per voice.
//
// MusicXML writes a measure as a single stream with a cursor. Notes advance
// it, <backup> rewinds it so another voice can be written over the same span,
// <forward> skips ahead, and <chord> attaches a note to the one before it
// without moving. MNX instead states each voice separately, and each
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
  isZero,
  subtractFractions,
} from '../fraction.js'
import type { Fraction } from '../fraction.js'
import { describeLength, noteValueOf } from './duration.js'
import type { ReportContext, WarningCollector } from './collector.js'
import type { EventNotation } from './eventNotations.js'
import type { XmlElement } from '../xml/parse.js'
import type { BeamedEvent, BeamMarker } from './beams.js'
import type { CarriedTupletStop, MeasureExtent, TupletStart } from './tuplets.js'
import { TupletTracker } from './tupletTracker.js'
import type {
  Arpeggio,
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

/** The last event of the measure before a point, on the staff given or any. */
export type LastEventBefore = (position: Fraction, staff?: number) => CoveredEvent | undefined

/** The last event of the measure on each staff that has one. */
export type LastEvents = () => ReadonlyMap<number, CoveredEvent>

/** How many grace notes stand at a point, on the staff given or any. */
export type GraceNotesAt = (position: Fraction, staff?: number) => number

/**
 * An event just put in its voice, and where it begins in the measure. A note's
 * notations are read once the cursor has moved past it, and a tie, slur or
 * roll written there belongs at the event's own place.
 */
export interface PlacedEvent {
  event: Event
  start: Fraction
}

/** The event a note of a chord joins, with what the chord's own note wrote on it. */
export interface JoinedEvent extends PlacedEvent {
  notations: readonly EventNotation[]
}

/** A grace note just put in its group, with the run its group beams within. */
export interface PlacedGraceNote extends PlacedEvent {
  beams: BeamedEvent[]
}

/** What a measure holds once every pass that waits for it to be whole has run. */
export interface FinishedMeasure {
  /** Each voice's events, in order, for its beams to be read from. */
  beamedEvents: BeamedEvent[][]
  arpeggios: Arpeggio[]
  sequences: Sequence[]
  /** Tuplet stops no bracket here met, handed on to the next measure. */
  carriedTupletStops: CarriedTupletStop[]
  /**
   * The voices whose primary beam is still open at the closing barline, with
   * the staff the beam's last event named.
   */
  beamsOpenAtBarline: ReadonlyMap<string, number | undefined>
}

/** Where the last item of a voice takes its time from, where it is a grace group. */
function graceTypeOf(builder: VoiceBuilder): GraceType | undefined {
  const last = builder.tuplets.list().at(-1)
  return last?.kind === 'grace' ? last.graceType : undefined
}

/** The name a voice goes under when the source does not give it one. */
const UNNAMED_VOICE = ''

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
  last: (JoinedEvent & { duration: Fraction | undefined }) | undefined
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
interface VoiceLayers {
  layers: VoiceBuilder[]
  active: number
}

/**
 * How a voice's measure rest is written, settled once the measure is whole:
 * on the sequence, which then holds nothing else, as an event, or as a space
 * where no note value writes the rest.
 */
export type MeasureRestForm = 'sequence' | 'event' | 'space'

/** What a measure rest loses in each form it can take. */
export type MeasureRestReports<Form extends MeasureRestForm = MeasureRestForm> = Partial<
  Record<Form, () => void>
>

/**
 * A rest that fills its voice's measure, or may, until finish settles how it
 * is written.
 *
 * - `candidate`: an ordinary rest that is the measure's rest only where it
 *   turns out to be the whole of its voice. It stays the event it was read
 *   as, or the sequence states it.
 * - `fills`: the rest fills the measure as read, and the voice holds nothing
 *   beside it but grace notes. It stands in the content as a space of its
 *   length, where one is known, and takes any form.
 * - `fills-as-event`: the rest fills the measure as read and carries what
 *   only an event holds, so it stays the event it was read as.
 */
type MeasureRest =
  | { readonly origin: 'fills-as-event' }
  | {
      readonly origin: 'candidate'
      readonly event: Event
      readonly reports: MeasureRestReports<'sequence' | 'event'>
    }
  | {
      readonly origin: 'fills'
      readonly onSequence: FullMeasureRest
      readonly space: Space | undefined
      /** The event a note value writes the rest as, where one does. */
      readonly asEvent: (() => Event) | undefined
      readonly at: Fraction
      /** The rest's entry in `placed`, which names its staff. */
      readonly placed: { event: Event | undefined; staff: number | undefined }
      readonly reports: MeasureRestReports
      readonly path: DocumentPath
      readonly line: number
    }

/** Whether the voice rests its measure with a rest that fills it as read. */
function restFills(builder: VoiceBuilder): boolean {
  const origin = builder.measureRest?.origin
  return origin !== undefined && origin !== 'candidate'
}

/** States the rest on the sequence, which then holds nothing else. */
function stateOnSequence(builder: VoiceBuilder, rest: FullMeasureRest): void {
  builder.content.length = 0
  builder.fullMeasure = rest
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
   * The number the source gives it, if any. Two chords
   * sounding together under the same number are one arpeggio rolled across
   * both, which is how a pianist's two hands are rolled as one gesture;
   * different numbers are two separate rolls. A marker stating no number
   * joins nothing beyond its own chord, because only a number joins two
   * chords.
   */
  number: string | undefined
  struck: boolean
  /**
   * The <arpeggiate> or <non-arpeggiate> the mark was written with. A roll is
   * reported once the measure is whole, so the element comes along with it.
   */
  element: XmlElement
  /** The mark marking the same chord the other way, where one does. */
  conflicted: XmlElement | undefined
  /** The mark rolling the same chord in the other direction, where one does. */
  crossed: XmlElement | undefined
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

/** The staff a voice is mostly on, or nothing when it names no staff. */
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
  /**
   * What a chord member joins: the event written last, in whatever voice. A
   * rest written last, whether it fills the measure or is passed over,
   * leaves only a rest to join.
   */
  #lastWritten: { readonly voice: string; readonly builder: VoiceBuilder } | 'rest' | undefined
  /**
   * The <backup> that carried the cursor before the measure start, held until
   * something is written out there or a <forward> brings the cursor back.
   */
  // The first note naming no voice, for the report where others name one.
  #unnamedNote: XmlElement | undefined
  #reached: { warnings: WarningCollector; context: ReportContext; backup: XmlElement } | undefined

  /** The voices that sound a note somewhere in the measure, rather than only rest. */
  readonly #soundingVoices: ReadonlySet<string>
  /**
   * The voices whose primary beam the measure before left open at the
   * barline, with its staff. Each is taken by the first event to carry it on.
   */
  readonly #beamsOpenBefore: Map<string, number | undefined>

  constructor(
    carriedStops: readonly CarriedTupletStop[],
    soundingVoices: Iterable<string | undefined>,
    beamsOpenBefore: ReadonlyMap<string, number | undefined>,
  ) {
    this.#carriedStops = [...carriedStops]
    this.#soundingVoices = new Set([...soundingVoices].map((voice) => voice ?? UNNAMED_VOICE))
    this.#beamsOpenBefore = new Map(beamsOpenBefore)
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
   * the whole measure's length whatever that voice wrote. Whatever is written
   * out there is written at the start instead.
   *
   * The cursor itself is left where the source put it, because a <forward>
   * can bring it back: sources write the pair to reach a point they draw at
   * the measure start. Taking the cursor to the start on the <backup> alone
   * would put everything after the <forward> that much later. The
   * <backup> that reached out is held rather than reported, so that a reach
   * a <forward> cancels is not reported and a reach several
   * <forward>s cancel is reported once.
   */
  shift(by: Fraction, warnings: WarningCollector, context: ReportContext, moved: XmlElement): void {
    this.#moveTo(addFractions(this.#cursor, by))
    if (compareFractions(this.#cursor, fraction(0)) >= 0) {
      this.#reached = undefined
      return
    }
    this.#reached ??= { warnings, context, backup: moved }
  }

  /**
   * The cursor where something is about to be written, and where it then
   * stays: writing at the measure start settles what a <backup> reaching
   * past it meant, and no later <forward> can take that back. The reach is
   * reported here.
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
        reached.context,
        reached.backup,
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
    this.#lastWritten = 'rest'
    this.#moveTo(addFractions(this.#cursor, by))
  }

  #moveTo(position: Fraction): void {
    this.#cursor = position
    if (compareFractions(position, this.#furthest) > 0) this.#furthest = position
  }

  /**
   * Whether any line of this voice is already a rest filling the measure.
   * Asked across all of them, because resting the measure is something the
   * voice does rather than one of its lines. Whether a rest written over it
   * is dropped is restIsRedundant's question.
   */
  restsTheMeasure(voice: string | undefined): boolean {
    return this.#layersFor(voice).layers.some(restFills)
  }

  /**
   * Whether a rest written at the cursor is silence over the voice's measure
   * rest. A rest in the line that rests the measure is. A rest in a line laid
   * over it is only where the voice sounds no note in the measure: where it
   * does, the rest is part of that line's music.
   */
  restIsRedundant(voice: string | undefined): boolean {
    if (!this.restsTheMeasure(voice)) return false
    return restFills(this.#builderFor(voice)) || !this.#soundingVoices.has(voice ?? UNNAMED_VOICE)
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
  /**
   * Notes a note that names no voice, grace notes included, for the report
   * where others in the measure name one. A chord member takes its chord's
   * voice, so it is not one.
   */
  namesNoVoice(note: XmlElement): void {
    this.#unnamedNote ??= note
  }

  beginNote(voice: string | undefined, note: XmlElement): void {
    this.#writeAt()
    const layers = this.#layersFor(voice)
    const before = layers.layers[layers.active] as VoiceBuilder
    const taken = this.#layerAt(voice, note)
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
    from.tuplets.list().pop()
    this.#fillGap(to)
    to.tuplets.list().push(waiting.group)
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
    notations: readonly EventNotation[],
    duration: Fraction,
    path: DocumentPath,
    line: number,
    staff?: number,
  ): PlacedEvent {
    if (restFills(this.#builderFor(voice))) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    const builder = this.#builderFor(voice)
    this.#fillGap(builder)

    builder.tuplets.list().push(event)
    // A bracket completed once the measure is whole can take in a rest
    // written straight after it, where the source drew that rest as one of
    // the tuplet's own notes and left it outside the bracket. Telling one
    // from a rest that lasts what it is written as needs the time the source
    // gave it, which nothing else keeps. Kept for every event, so that
    // anything standing in a voice's list has one.
    builder.spent.set(event, duration)
    builder.grace = undefined
    builder.placed.push({ event, staff })
    builder.lastEvent = { id: event.id, staff }
    this.#lastWritten = { voice: voice ?? UNNAMED_VOICE, builder }
    const start = this.#cursor
    builder.last = { event, notations, duration, start }
    this.#eventStarts.push({ start, staff, grace: false })
    builder.tuplets.addTremoloNote(duration)
    builder.end = addFractions(start, duration)
    this.#moveTo(builder.end)
    return { event, start }
  }

  /**
   * States as a space whatever time this voice has passed over in silence
   * since it last sounded. MusicXML leaves such a gap implicit by moving its
   * cursor; MNX has to state it, because a sequence runs without interruption
   * from wherever it starts.
   */
  #fillGap(builder: VoiceBuilder): void {
    const gap = subtractFractions(this.#cursor, builder.end)
    if (compareFractions(gap, fraction(0)) > 0) {
      builder.tuplets.addSkip(gap)
      builder.end = this.#cursor
    }
  }

  /**
   * Settles every bracket of the measure, the measure being whole. What a
   * bracket writes turns on what it holds once the brackets inside it are
   * written, on the frame the brackets around it write in, and on the silence
   * after it.
   *
   * `measure` is the measure's own shape: where its beats line up, how far it
   * runs, and the time signature it runs against.
   */
  #settleMeasure(measure: MeasureExtent, warnings: WarningCollector, context: ReportContext): void {
    for (const builder of this.#allBuilders()) {
      const voice = {
        content: builder.content,
        end: builder.end,
        measure,
        spent: builder.spent,
      }
      builder.end = builder.tuplets.settle(voice, warnings, context)
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
   *
   * No point asks for the last event of the whole measure.
   */
  #lastEventBefore(position: Fraction | undefined, staff?: number): CoveredEvent | undefined {
    let latest: Fraction | undefined
    for (const event of this.#eventStarts) {
      if (staff !== undefined && (event.staff ?? 1) !== staff) continue
      if (position !== undefined && compareFractions(event.start, position) >= 0) continue
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

  /** The last event of the measure on each staff, grace notes after it included. */
  #lastEvents(): Map<number, CoveredEvent> {
    const lastOn = new Map<number, CoveredEvent>()
    for (const staff of new Set(this.#eventStarts.map((event) => event.staff ?? 1))) {
      const last = this.#lastEventBefore(undefined, staff)
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
    return this.#eventStarts.filter(
      (event) =>
        event.grace &&
        (staff === undefined || (event.staff ?? 1) === staff) &&
        compareFractions(event.start, position) === 0,
    ).length
  }

  /**
   * Where the grace group open in this voice takes its time from, or nothing
   * where the group says nothing. A grace note taking another side starts a
   * group of its own.
   */
  openGraceType(voice: string | undefined): GraceType | undefined {
    return graceTypeOf(this.#builderFor(voice))
  }

  /**
   * Where the grace group a chord note is joining takes its time from, or
   * nothing where the group says nothing. The group is the last thing added,
   * so this is what a member of it has to agree with.
   */
  chordGraceType(): GraceType | undefined {
    const builder = this.#chordBuilder()
    return builder && graceTypeOf(builder)
  }

  /** The staff the event a chord note would join was placed on. */
  staffOfChord(): number | undefined {
    return this.#chordBuilder()?.placed.at(-1)?.staff
  }

  /** The written value of the event a chord note would join. */
  chordValue(): NoteValue | undefined {
    return this.#chordBuilder()?.last?.event.value
  }

  /**
   * Whether the event a chord note would join is a grace note, and nothing
   * where there is no event to join.
   */
  chordIsGrace(): boolean | undefined {
    const last = this.#chordBuilder()?.last
    return last && last.duration === undefined
  }

  /** How long the event a chord note would join lasts. */
  chordDuration(): Fraction | undefined {
    return this.#chordBuilder()?.last?.duration
  }

  /** The voice line holding the event a chord note would join. */
  #chordBuilder(): VoiceBuilder | undefined {
    return typeof this.#lastWritten === 'object' ? this.#lastWritten.builder : undefined
  }

  /**
   * Adds a note carrying <chord>, which sounds with the event before it
   * rather than after. The cursor does not move.
   */
  addChordNote(
    note: Note,
    duration: Fraction | undefined,
    path: DocumentPath,
    line: number,
  ): JoinedEvent {
    const placed = this.#chordEvent(duration, path, line)
    placed.event.notes = [...placed.event.notes, note]
    return placed
  }

  /** The same, for a note struck on a percussion kit. */
  addChordKitNote(
    note: KitNote,
    duration: Fraction | undefined,
    path: DocumentPath,
    line: number,
  ): JoinedEvent {
    const placed = this.#chordEvent(duration, path, line)
    placed.event.kitNotes = [...placed.event.kitNotes, note]
    return placed
  }

  /** The event a chord member joins, held to lasting as long as the chord. */
  #chordEvent(duration: Fraction | undefined, path: DocumentPath, line: number): JoinedEvent {
    const previous = this.#chordBuilder()?.last
    if (!previous && this.#lastWritten !== 'rest') {
      throw new MusicXMLError('A <note> is marked as a chord with no note for it to join.', {
        path,
        line,
      })
    }

    // The event a note joins has to be a note itself. A rest sounds nothing,
    // so a note written onto one has no chord to be part of, the same way a
    // rest written into a chord has none.
    if (!previous || previous.event.isRest) {
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

    return { event: previous.event, start: previous.start, notations: previous.notations }
  }

  /**
   * Adds a rest filling the measure, which then holds nothing but grace
   * notes. MNX states such a rest on the sequence rather than as an event,
   * so a voice cannot be both. It stands in the content as a space of what
   * it `lasts` until the measure is whole, and `asEvent` is the event a note
   * value writes it as where grace notes stand beside it.
   */
  setFullMeasure(
    voice: string | undefined,
    rest: FullMeasureRest,
    lasts: Fraction | undefined,
    staff: number | undefined,
    asEvent: (() => Event) | undefined,
    reports: MeasureRestReports,
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (this.restsTheMeasure(voice)) {
      throw new MusicXMLError('A voice has more than one rest that fills the measure.', {
        path,
        line,
      })
    }
    // MNX states such a rest on the sequence, where a bracket cannot reach
    // it, so a tuplet or a tremolo open around it is its own refusal. It is
    // checked before the content check below, because a tuplet's own item is
    // already in the content and would otherwise refuse the rest as notes
    // that are not there.
    const opened = builder.tuplets.scaledBy()
    if (opened) {
      throw new MusicXMLError(
        `A rest that fills the measure is inside ${
          opened === 'tuplet' ? 'a <tuplet>' : 'a two-note tremolo'
        }. MNX states such a rest on the sequence rather than as an event, so nothing ` +
          'can hold it.',
        { path, line },
      )
    }
    // Grace notes take none of the measure's time, so a rest written at the
    // measure start after them still fills the measure.
    if (
      builder.content.length > 0 &&
      (!this.holdsOnlyGraceNotes(voice) || !this.atMeasureStart())
    ) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    this.#writeAt()
    this.#fillGap(builder)
    const at = this.#cursor
    // The rest is the whole of this voice in this measure, so the staff it
    // names is the staff the sequence sits on.
    const placed = { event: undefined, staff }
    builder.placed.push(placed)
    const space: Space | undefined = lasts && { kind: 'space', duration: lasts }
    if (space) {
      builder.content.push(space)
      builder.end = addFractions(at, space.duration)
      this.#moveTo(builder.end)
    }
    builder.grace = undefined
    this.#lastWritten = 'rest'
    builder.measureRest = {
      origin: 'fills',
      onSequence: rest,
      space,
      asEvent,
      at,
      placed,
      reports,
      path,
      line,
    }
  }

  /**
   * Adds a rest filling the measure as an event, which then holds nothing
   * else. Grace notes before it take none of the measure's time, so they are
   * the only thing it can follow.
   */
  addMeasureRestEvent(
    voice: string | undefined,
    event: Event,
    notations: readonly EventNotation[],
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
    const placed = this.addEvent(voice, event, notations, duration, path, line, staff)
    builder.measureRest = { origin: 'fills-as-event' }
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
    context: ReportContext,
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
    // Time this voice has passed over in silence belongs before the brackets,
    // not inside them, where the tuplets' ratios would scale it.
    this.#fillGap(builder)
    builder.tuplets.openTuplets(
      inner,
      outer,
      starts,
      derived,
      builder.end,
      warnings,
      context,
      path,
      line,
    )
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
    ratio: XmlElement,
  ): void {
    const builder = this.#builderFor(voice)
    // Time this voice passed over in silence belongs before the tuplet, not
    // inside it, where the ratio would scale it.
    this.#fillGap(builder)
    builder.tuplets.openImplied(inner, outer, ratio, builder.end)
  }

  /** Whether this voice is inside a tuplet stated as a ratio with no bracket. */
  insideImpliedTuplet(voice: string | undefined): boolean {
    return this.#builderFor(voice).tuplets.insideImplied()
  }

  /** Whether a two-note tremolo is open in this voice. */
  insideTremolo(voice: string | undefined): boolean {
    return this.#builderFor(voice).tuplets.insideTremolo()
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice holds all its
   * ratio counts once the time the voice has passed over in silence stands
   * inside it. False where no such tuplet is open.
   */
  impliedTupletFull(voice: string | undefined): boolean {
    const builder = this.#builderFor(voice)
    return builder.tuplets.impliedFullAt(this.#cursor, builder.end)
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice ends before a note
   * stating `quantities`. False where no such tuplet is open.
   */
  impliedTupletEndsBefore(
    voice: string | undefined,
    quantities: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined,
  ): boolean {
    const builder = this.#builderFor(voice)
    return builder.tuplets.impliedEndsBefore(this.#cursor, builder.end, quantities)
  }

  /**
   * Whether the tuplet the ratio alone opened in this voice holds all its
   * ratio counts. False where no such tuplet is open.
   */
  impliedTupletFilled(voice: string | undefined): boolean {
    return this.#builderFor(voice).tuplets.impliedFilled()
  }

  /**
   * Closes the measure once every element of it is read, running the passes
   * that wait for the measure to be whole in the order each needs the one
   * before it.
   *
   * A rest filling the measure takes its form first, because the brackets
   * read what stands beside them: as a space it would be silence a bracket
   * can take in. Tuplets close next: what a bracket writes turns on what it
   * holds, on the frame the brackets around it write in, and on the silence
   * after it. A rest that is the whole of its voice only once the brackets
   * are written is then read as the measure's rest. Then every event of the
   * measure is in, so a hairpin's and an octave shift's stop can each be
   * told which one it covers, whatever order the source wrote them in. A
   * rest read as an event and then stated on the sequence still counts as
   * one there.
   */
  finish(
    opening: Omit<MeasureExtent, 'length'>,
    settleSpanCovers: (
      lastEventBefore: LastEventBefore,
      graceNotesAt: GraceNotesAt,
      lastEvents: LastEvents,
    ) => void,
    /** The components this part strikes, which is where a kit note's height is. */
    kit: ReadonlyMap<string, KitComponent>,
    warnings: WarningCollector,
    context: ReportContext,
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
    this.#settleFillingRests()
    this.#settleMeasure({ anchor, length, signature }, warnings, context)
    this.#settleCandidateRests()

    settleSpanCovers(
      (position, staff) => this.#lastEventBefore(position, staff),
      (position, staff) => this.graceNotesAt(position, staff),
      () => this.#lastEvents(),
    )

    return {
      beamedEvents: this.#beamedEvents(),
      arpeggios: this.#settleArpeggios(warnings, context, kit),
      sequences: this.#sequences(warnings, context),
      carriedTupletStops,
      beamsOpenAtBarline: this.#beamsOpenAtBarline(),
    }
  }

  /**
   * The voices whose last event begins or continues a primary beam, which
   * the source then carries on over the barline or leaves open. An event
   * with no primary marker, or no beam at all, closes the primary beam.
   */
  #beamsOpenAtBarline(): Map<string, number | undefined> {
    const open = new Map<string, number | undefined>()
    for (const [voice, { layers }] of this.#voices) {
      for (const { beamed, lastEvent } of layers) {
        const last = beamed.at(-1)
        const kind = last?.markers.get(1)?.kind
        if (lastEvent?.id === last?.id && (kind === 'begin' || kind === 'continue')) {
          open.set(voice, lastEvent?.staff)
        }
      }
    }
    return open
  }

  /**
   * Closes any tuplet the ratio alone opened, in every voice. A run of such
   * notes ends where the measure does, whether or not it filled its ratio.
   */
  #closeImpliedTuplets(
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    for (const builder of this.#allBuilders()) {
      builder.tuplets.closeImplied(builder.end, warnings, context, path, line)
    }
  }

  /**
   * How much of its written value a note in this voice lasts, given
   * every tuplet currently open around it: 2/3 inside a triplet, and the
   * ratios multiply where tuplets nest. Inside a two-note tremolo each note
   * is written with the value of the pair, so it lasts half of it.
   */
  noteFactor(voice: string | undefined): Fraction {
    return this.#builderFor(voice).tuplets.noteFactor()
  }

  /**
   * What is open around a note in this voice scaling its written value, for a
   * report to name.
   */
  scaledBy(voice: string | undefined): 'tuplet' | 'tremolo' | undefined {
    return this.#builderFor(voice).tuplets.scaledBy()
  }

  /**
   * Starts a two-note tremolo in this voice. The notes added while it is
   * open are gathered, and join the content as one item when it closes.
   */
  openTremolo(voice: string | undefined, marks: number, path: DocumentPath, line: number): void {
    const builder = this.#builderFor(voice)
    // Time this voice has passed over in silence belongs before the tremolo.
    this.#fillGap(builder)
    builder.tuplets.openTremolo(marks, path, line)
  }

  /**
   * Closes the tremolo: two notes of one written value, together occupying
   * twice their measured duration. Anything else is refused, because the
   * measure would not add up.
   */
  closeTremolo(
    voice: string | undefined,
    marker: { marks: number; element: XmlElement },
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const { marks } = marker
    const builder = this.#builderFor(voice)
    const pending = builder.tuplets.closeTremolo(path, line)

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

    builder.tuplets.list().push({
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
    markers: ReadonlyMap<number, BeamMarker>,
    beamCount: number,
    start: Fraction,
    /** The run of a grace note's group, which its beams run within. */
    graceBeams: BeamedEvent[] | undefined,
  ): void {
    if (markers.size === 0) return
    const builder = this.#builderFor(voice)
    const key = voice ?? UNNAMED_VOICE
    // A named voice may beam across staves. Where the source names no
    // voice, the staff is all that tells two lines apart, so the beam carries
    // on only on the staff it left.
    const continues =
      !graceBeams &&
      isZero(start) &&
      this.#beamsOpenBefore.has(key) &&
      (voice !== undefined || this.#beamsOpenBefore.get(key) === builder.lastEvent?.staff)
    if (continues) this.#beamsOpenBefore.delete(key)
    const run = graceBeams ?? builder.beamed
    run.push({ id, markers, beamCount, continuesFromBefore: continues })
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
    /** The element the mark is written with, for the report that comes later. */
    element: XmlElement,
  ): void {
    // Every note of a chord carries the mark, so the first one to arrive sets
    // it up and the rest join what it already covers. Marks on one chord are
    // that chord's own roll however the source numbers them, because sources
    // number one note and leave the next bare. Only two stated numbers that
    // differ are two rolls.
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
      if (
        existing.direction !== undefined &&
        direction !== undefined &&
        existing.direction !== direction
      ) {
        existing.crossed ??= element
      }
      existing.direction ??= direction
      existing.arrow ||= arrow
      // Rolled and struck together are opposite instructions.
      if (existing.struck !== struck) existing.conflicted ??= element
      return
    }

    this.#arpeggios.push({
      event,
      notes: note ? [note] : [],
      position,
      number,
      struck,
      element,
      conflicted: undefined,
      crossed: undefined,
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
    context: ReportContext,
    /** The components this part strikes, which is where a kit note's height is. */
    kit: ReadonlyMap<string, KitComponent>,
  ): Arpeggio[] {
    // Marks on one chord are compared together first, whatever they are
    // numbered, so a chord marked rolled on one note and struck on another is
    // seen as one chord.
    const kept: MarkedArpeggio[] = []
    for (const marked of this.#arpeggios) {
      const first = kept.find((one) => one.event === marked.event)
      if (first && first.struck !== marked.struck) {
        warnings.add(
          'unrepresentable:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          context,
          marked.element,
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
          (first.struck
            ? 'A rest is bracketed as struck together, and a bracket runs between notes, '
            : 'A rest is marked as rolled, and a roll runs between notes, ') +
            'so it is not carried over.',
          context,
          first.element,
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
          context,
          first.element,
        )
        continue
      }

      // A chord sounding on a pitched staff and a kit at once is spanned by
      // its pitched notes: a diatonic index and a staff height do not
      // compare, and ordering the two together would mean reading each pitch
      // against the clef drawing it. MNX reads the notes a mark covers as the
      // ones whose pitch lies between its ends, so a kit note left out of the
      // span is left out of the mark. Reported here rather than above, where
      // the mark may still turn out not to be carried.
      if (notes.length > 0 && kitNotes.length > 0) {
        warnings.add(
          'unsupported:element',
          `A chord ${first.struck ? 'bracketed as struck together' : 'rolled'} across a ` +
            'pitched staff and a percussion kit is carried over its pitched notes only, ' +
            'which is not the whole chord.',
          context,
          first.element,
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
          context,
          first.element,
        )
      }

      const crossed = group.find((one) => one.crossed)?.crossed
      if (crossed) {
        warnings.add(
          'inconsistent:arpeggio',
          'A chord is rolled upwards by one mark and downwards by another. The first ' +
            'is the one converted.',
          context,
          crossed,
        )
      }

      const conflicted =
        group.find((one) => one.conflicted)?.conflicted ??
        group.find((one) => one.struck !== first.struck)?.element
      if (conflicted) {
        warnings.add(
          'unrepresentable:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          context,
          conflicted,
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
    return this.#builderFor(voice).tuplets.insideBracket()
  }

  /**
   * The voice of the event a chord note would join. A chord member may leave
   * <voice> off, and Sibelius does, so it belongs to the event it joins
   * rather than to the unnamed voice.
   */
  voiceOfChord(): string | undefined {
    return typeof this.#lastWritten === 'object' ? this.#lastWritten.voice : undefined
  }

  /**
   * Records a tuplet this voice never opened, by the number its start marker
   * stated, so the stop that matches it can be dropped with it.
   */
  dropTupletStart(voice: string | undefined, number: string): void {
    this.#builderFor(voice).tuplets.dropStart(number)
  }

  /**
   * Whether this stop closes a tuplet there is no bracket of its own to close:
   * one whose start was dropped where it could not be drawn, or one an earlier
   * measure closed at its barline. A bracket of that number standing open is
   * what the stop closes instead: the source numbers every tuplet 1 unless it
   * nests them, so a dropped start and an open bracket often share a number,
   * and taking the stop from the open bracket would leave it
   * open to the end of the measure. A run the ratio alone opened is not a
   * bracket, and no stop the source wrote is its own.
   *
   * The record is consumed, so a second stop stating the number closes an
   * open bracket as any other stop does.
   */
  closesDroppedTuplet(voice: string | undefined, number: string): boolean {
    if (this.#builderFor(voice).tuplets.takesDroppedStart(number)) return true

    // A stop written inside a bracket the source drew names that bracket,
    // however the source numbers the two, so a carried stop is taken only
    // where this voice has no such bracket open, in any of its lines. A run
    // the ratio alone opened is not one: the source drew no bracket for it,
    // and it ends by its own count rather than on a stop.
    //
    // A bracket cut at a barline is usually carried on by notes that state
    // the same ratio, which opens such a run. Without this test, the stop that
    // ends the source's bracket would close the run, and the record of the
    // cut bracket would stay for the rest of the part and match a later,
    // unrelated stop.
    const drawn = this.#layersFor(voice).layers.some((layer) => layer.tuplets.insideDrawnBracket())
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
   * its start marker stated, or nothing where no tuplet is open. `stop` is
   * the <tuplet> marker closing it.
   */
  closeTuplet(
    voice: string | undefined,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
    stop: XmlElement,
  ): string | undefined {
    const builder = this.#builderFor(voice)
    return builder.tuplets.closeTuplet(builder.end, warnings, context, path, line, stop)
  }

  /**
   * Closes the run the ratio alone opened in this voice, where one is open. A
   * skip that fills exactly what the run's ratio still counts goes inside it
   * first.
   */
  closeImpliedTuplet(
    voice: string | undefined,
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (builder.tuplets.impliedCompletedAt(this.#cursor, builder.end)) this.#fillGap(builder)
    builder.tuplets.closeImplied(builder.end, warnings, context, path, line)
  }

  /**
   * Adds a grace note, which takes none of the measure's time. Consecutive
   * grace notes gather into one group, as they are played and drawn, unless
   * they take their time from different sides.
   */
  addGraceNote(
    voice: string | undefined,
    event: Event,
    notations: readonly EventNotation[],
    slashed: boolean,
    graceType: GraceType | undefined,
    staff?: number,
  ): PlacedGraceNote {
    const builder = this.#builderFor(voice)
    this.#writeAt()
    // A grace note is drawn before the note it ornaments, so time the voice
    // has passed over in silence goes before the group. This keeps the group
    // beside its note, not at the point the voice last sounded.
    this.#fillGap(builder)

    const list = builder.tuplets.list()
    const open = builder.grace

    this.#lastWritten = { voice: voice ?? UNNAMED_VOICE, builder }
    // Grace notes have no duration of their own, so a chord note joining one
    // has nothing to agree with.
    const start = this.#cursor
    builder.last = { event, notations, duration: undefined, start }
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
      open !== undefined &&
      list.at(-1) === open.group &&
      (graceType === undefined ||
        open.group.graceType === undefined ||
        open.group.graceType === graceType)
    ) {
      const { group } = open
      group.content = [...group.content, event]
      if (slashed) group.slashed = true
      group.graceType ??= graceType
      return { event, start, beams: open.beams }
    }

    const group: GraceGroup = { kind: 'grace', content: [event], slashed, graceType }
    list.push(group)
    // Each group beams within itself, so each starts a run of its own.
    const beams: BeamedEvent[] = []
    builder.graceBeamed.push(beams)
    // Held until the note it leads into says which sequence it is in. Its
    // own entry in `placed` is the one just pushed.
    builder.grace = { group, beams, at: start, placedFrom: builder.placed.length - 1 }
    return { event, start, beams }
  }

  /**
   * Marks the rest just added as one that could be this voice's measure rest,
   * to be settled by finish once the voice is whole.
   */
  markMeasureRest(
    voice: string | undefined,
    event: Event,
    reports: MeasureRestReports<'sequence' | 'event'>,
  ): void {
    this.#builderFor(voice).measureRest = { origin: 'candidate', event, reports }
  }

  /**
   * Settles how each rest filling the measure as read is written, and
   * reports what that form loses.
   *
   * MNX states a measure rest on a sequence that holds nothing else. Grace
   * notes beside the rest have nowhere to stand there, so the rest is written
   * as the event a note value writes it as, or as a space of its length where
   * none can. Which side of the rest the grace notes are written on says
   * nothing about the music, so both orders are written alike.
   */
  #settleFillingRests(): void {
    for (const builder of this.#allBuilders()) {
      const rest = builder.measureRest
      if (rest?.origin !== 'fills') continue
      const form = this.#settleFillingRest(builder, rest)
      rest.reports[form]?.()
    }
  }

  #settleFillingRest(
    builder: VoiceBuilder,
    rest: Extract<MeasureRest, { origin: 'fills' }>,
  ): MeasureRestForm {
    // Anything in the content but a space is a grace note.
    if (builder.content.every((item) => item.kind === 'space')) {
      stateOnSequence(builder, rest.onSequence)
      return 'sequence'
    }
    const { space, asEvent } = rest
    if (!space) {
      throw new MusicXMLError(
        'A grace note stands beside a rest that fills the measure, and neither a note ' +
          'value nor a length says how long that rest lasts.',
        { path: rest.path, line: rest.line },
      )
    }
    if (!asEvent) return 'space'

    const event = asEvent()
    builder.content[builder.content.indexOf(space)] = event
    builder.spent.set(event, space.duration)
    rest.placed.event = event
    this.#eventStarts.push({ start: rest.at, staff: rest.placed.staff, grace: false })
    return 'event'
  }

  /**
   * Reads a rest that is the whole of its voice as that voice's measure rest,
   * the brackets being written, and reports what the form it takes loses.
   *
   * A bar of silence is drawn with a whole rest whatever the meter says, so a
   * 3/2 measure rests with a whole rest lasting a dotted whole. Where the
   * exporter leaves measure="yes" off, taking the written value as the rest's
   * length leaves the measure short. MNX has the full-measure rest's
   * visualDuration for this: the rest lasts the measure, and the value drawn
   * is stated beside it. Such a rest is not the measure's rest wherever it
   * stands: sources write one beside other notes, and the voice has to be
   * whole before the two can be told apart.
   *
   * The sequence carries no marking, no stem, no beam and no roll, and has
   * no id for a slur or a lyric to reach, so anything reaching the rest keeps
   * it an event.
   */
  #settleCandidateRests(): void {
    for (const builder of this.#allBuilders()) {
      const rest = builder.measureRest
      if (rest?.origin !== 'candidate') continue
      const { event } = rest
      const reached =
        builder.beamed.length > 0 ||
        event.stemDirection !== undefined ||
        event.lyrics.size > 0 ||
        Object.keys(event.markings).length > 0 ||
        this.#arpeggios.some((marked) => marked.event === event)
      if (reached || builder.content.length !== 1 || builder.content[0] !== event) {
        rest.reports.event?.()
        continue
      }
      // The rest is the whole of the voice, so the staff it named stays as
      // the sequence's own. Its entry keeps naming the event it came from,
      // which nothing writes once the content is empty.
      const { value, fermata, staffPosition } = event
      stateOnSequence(builder, { visualDuration: value, fermata, staffPosition })
      rest.reports.sequence?.()
    }
  }

  /**
   * Settles what the measure leaves open at its barline, and hands back the
   * stops the measures after it will meet with nothing to close.
   *
   * A stop carried in and not met here is handed on with them. The source may
   * write it any number of measures later, and a stop that closes nothing is
   * passed over rather than refusing the file, as one whose start was dropped
   * already is.
   */
  #closeAtBarline(
    warnings: WarningCollector,
    context: ReportContext,
    path: DocumentPath,
    line: number,
  ): CarriedTupletStop[] {
    const carried = [...this.#carriedStops]
    for (const [voice, layers] of this.#voices) {
      for (const builder of layers.layers) {
        const numbers = builder.tuplets.closeAtBarline(builder.end, warnings, context, path, line)
        carried.push(...numbers.map((number) => ({ voice, number })))
      }
    }
    return carried
  }

  /**
   * The sequences, in the order their voices first appeared.
   *
   * A voice belongs to the staff that holds most of its time, and only the
   * events that reach across to another say so. Choosing the commonest that
   * way keeps the overrides to the notes that cross.
   */
  #sequences(warnings: WarningCollector, context: ReportContext): Sequence[] {
    // A note that names no voice goes into its own bucket. Beside notes that do
    // name a voice, that splits one measure into two sequences with no way to
    // know the source meant them apart, so the split is reported rather than
    // silent.
    const unnamed = this.#unnamedNote
    if (unnamed && this.#voices.size > 1 && this.#voices.has(UNNAMED_VOICE)) {
      warnings.add(
        'missing:voice',
        'A note names no voice while others in the measure do. It is kept as a ' + 'separate line.',
        context,
        unnamed,
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
        context,
        openedAt,
      )
    }

    // MNX lets no two sequences of a measure share a voice name, and a
    // sequence laid over a voice has none of its own: the source named one
    // voice for both. Naming both by it would state that two sequences are
    // one, and leaving every laid-over sequence unnamed leaves two of them in
    // a measure that nothing can tell apart. Each takes a name of its own,
    // built from the voice it was laid over and its place among that voice's
    // sequences, and stepped on past any name the measure already uses.
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
  #layerAt(voice: string | undefined, note: XmlElement): VoiceBuilder {
    const layers = this.#layersFor(voice)
    const free = (candidate: VoiceBuilder) => compareFractions(this.#cursor, candidate.end) >= 0

    let index = free(layers.layers[layers.active] as VoiceBuilder)
      ? layers.active
      : layers.layers.findIndex(free)
    if (index === -1) {
      index = layers.layers.length
      layers.layers.push(newVoiceBuilder(note))
    }
    layers.active = index
    return layers.layers[index] as VoiceBuilder
  }

  /** Every sequence of every voice, voice by voice. */
  #allBuilders(): VoiceBuilder[] {
    return [...this.#voices.values()].flatMap((layers) => layers.layers)
  }
}

function newVoiceBuilder(openedAt?: XmlElement): VoiceBuilder {
  // One array: the tracker puts what no bracket holds in the voice's own list.
  const content: SequenceItem[] = []
  return {
    openedAt,
    beamed: [],
    graceBeamed: [],
    placed: [],
    lastEvent: undefined,
    tuplets: new TupletTracker(content),
    content,
    end: fraction(0),
    last: undefined,
    grace: undefined,
    measureRest: undefined,
    fullMeasure: undefined,
    spent: new Map(),
  }
}
