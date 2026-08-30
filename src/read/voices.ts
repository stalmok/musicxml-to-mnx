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
import { describeLength, lengthOf, noteValueOf } from './duration.js'
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { BeamedEvent } from './beams.js'
import type {
  Arpeggio,
  Event,
  FullMeasureRest,
  GraceGroup,
  Note,
  NoteValue,
  NoteValueQuantity,
  Pitch,
  Sequence,
  SequenceItem,
  Tuplet,
  TupletDisplay,
} from '../model/score.js'

/** What the source draws of a tuplet, read from its start bracket. */
export interface TupletDisplaySettings {
  bracket?: 'yes' | 'no'
  showNumber?: TupletDisplay
  showValue?: TupletDisplay
  orient?: 'above' | 'below'
}

/** One tuplet start read from a note: how it is drawn, the ratio its start
 * marker states of its own, when it states one, and the number the marker
 * gives it, which its stop restates. */
export interface TupletStart {
  display: TupletDisplaySettings
  stated: { inner: NoteValueQuantity; outer: NoteValueQuantity } | undefined
  number: string
}

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
   * filling the measure names one without being an event, so it contributes
   * the staff and nothing to override.
   */
  placed: { event: Event | undefined; staff: number | undefined }[]
  /**
   * The item lists currently being filled, outermost first. A tuplet or a
   * tremolo opens a new one, so notes land inside it until it closes. Each
   * says what opened it, because a tuplet edge and a tremolo edge can land
   * on different notes, and closing one while the other is open must refuse
   * rather than pop the wrong list and lose what it held.
   */
  open: { list: SequenceItem[]; opened: 'voice' | 'tuplet' | 'tremolo' }[]
  /**
   * The tuplets currently open, innermost last, each with how much of its
   * written value a note inside really lasts (2/3 inside a triplet), and the
   * number its start marker gave it, for its stop to be checked against.
   */
  openTuplets: { tuplet: Tuplet; ratio: Fraction; number: string }[]
  /**
   * The two-note tremolo currently being gathered, when one is. Its item is
   * not in the content yet: it joins once both notes are in and agree.
   */
  openTremolo: { marks: number; durations: Fraction[] } | undefined
  content: SequenceItem[]
  /** Where this voice's content runs out, measured from the measure start. */
  end: Fraction
  /**
   * The most recent event, which a chord note joins. Held directly rather
   * than looked up, because it can sit inside a tuplet or a grace group that
   * has since closed.
   */
  lastEvent: Event | undefined
  /** How long that event lasts, for chord notes to agree with. */
  lastDuration: Fraction | undefined
  /**
   * Where that event begins. Held because a chord note is read after the
   * cursor has already moved past the event it joins, and an arpeggio over
   * the chord belongs at the event's own place in the measure.
   */
  lastStart: Fraction | undefined
  fullMeasure: FullMeasureRest | undefined
}

/** A chord marked as rolled or struck, held until its notes are all in. */
interface MarkedArpeggio {
  event: Event
  position: Fraction
  /**
   * What the source numbers it. Two chords sounding together under the same
   * number are one arpeggio rolled across both, which is how a pianist's two
   * hands are rolled as one gesture; different numbers are two separate
   * rolls. Eleven of the corpus's are the cross-staff kind.
   */
  number: string
  struck: boolean
  /** True where the same chord was marked the other way as well. */
  conflicted: boolean
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

/** The space a tuplet is played in, against what is written in it. */
function ratioOf(inner: NoteValueQuantity, outer: NoteValueQuantity): Fraction {
  const written = multiplyFractions(fraction(inner.multiple), lengthOf(inner.value))
  const played = multiplyFractions(fraction(outer.multiple), lengthOf(outer.value))
  return divideFractions(played, written)
}

/** How long a tuplet's content is written as, before its ratio scales it. */
function writtenLengthOf(items: readonly SequenceItem[]): Fraction {
  let total = fraction(0)
  for (const item of items) {
    // A grace group takes none of the measure's time, so it adds nothing.
    if (item.kind === 'event') total = addFractions(total, lengthOf(item.value))
    if (item.kind === 'space') total = addFractions(total, item.duration)
    if (item.kind === 'tuplet' || item.kind === 'multiNoteTremolo') {
      // A nested tuplet stands in its parent for the space it is played in,
      // and a tremolo for the time its pair occupies.
      total = addFractions(
        total,
        multiplyFractions(fraction(item.outer.multiple), lengthOf(item.outer.value)),
      )
    }
  }
  return total
}

interface TupletLevel {
  inner: NoteValueQuantity
  outer: NoteValueQuantity
  display: TupletDisplaySettings
  number: string
}

/**
 * The ratio each tuplet level opening on one note states, outermost first.
 *
 * A note's <time-modification> is cumulative: inside nested tuplets it states
 * the combined ratio of every level, not each one's own. Where every share is
 * known - each start marker states its ratio, or all but one do and the last
 * takes what remains - the markers are used, provided they multiply out to
 * what the <time-modification> requires. Otherwise each level is recovered by
 * division: the outermost open level keeps the cumulative ratio exactly as
 * the source writes it, and each further level divides out what is already
 * open. That division cannot split the cumulative ratio between two levels
 * opening on the same note, which is what the markers are for.
 *
 * The notes' durations follow the <time-modification>, so it governs timing.
 * Markers whose stated ratios do not multiply out to it disagree with the
 * notes; the division is kept and the disagreement reported.
 */
function tupletLevels(
  openRatios: readonly Fraction[],
  inner: NoteValueQuantity,
  outer: NoteValueQuantity,
  starts: readonly TupletStart[],
  warnings: WarningCollector,
  context: WarningContext,
  line: number,
): TupletLevel[] {
  const enclosing = openRatios.reduce(multiplyFractions, fraction(1))
  const cumulative = ratioOf(inner, outer)
  // What the levels opening on this note must multiply to, together.
  const required = divideFractions(cumulative, enclosing)

  const known = starts.flatMap((start) =>
    start.stated ? [{ ...start.stated, display: start.display, number: start.number }] : [],
  )
  if (known.length > 0) {
    const holes = starts.length - known.length
    const product = known
      .map((level) => ratioOf(level.inner, level.outer))
      .reduce(multiplyFractions, fraction(1))

    if (holes === 0 && compareFractions(product, required) === 0) {
      return known
    }
    if (holes === 1) {
      const rest = divideFractions(required, product)
      return starts.map((start) => ({
        ...(start.stated ?? {
          inner: { value: inner.value, multiple: rest.den },
          outer: { value: outer.value, multiple: rest.num },
        }),
        display: start.display,
        number: start.number,
      }))
    }
    warnings.add(
      'inconsistent:tuplet',
      "A tuplet's start marker states a ratio that disagrees with the notes' " +
        '<time-modification>. The ratio the notes state is the one converted.',
      { ...context, line },
      'tuplet',
    )
  }

  const levels: TupletLevel[] = []
  let open = enclosing
  let depth = openRatios.length
  for (const start of starts) {
    let level: TupletLevel = { inner, outer, display: start.display, number: start.number }
    if (depth > 0) {
      const perLevel = divideFractions(cumulative, open)
      level = {
        inner: { value: inner.value, multiple: perLevel.den },
        outer: { value: outer.value, multiple: perLevel.num },
        display: start.display,
        number: start.number,
      }
    }
    levels.push(level)
    open = multiplyFractions(open, ratioOf(level.inner, level.outer))
    depth += 1
  }
  return levels
}

/** The list a note added now would land in: the innermost one still open. */
function innermost(builder: VoiceBuilder): SequenceItem[] {
  const frame = builder.open.at(-1)
  /* v8 ignore next -- the root list is never popped, so one is always open. */
  if (!frame) throw new Error('A voice has no open content list.')
  return frame.list
}

/**
 * Collects a measure's notes into per-voice sequences while following
 * MusicXML's cursor. Callers push what they read in document order.
 */
export class MeasureBuilder {
  readonly #voices = new Map<string, VoiceBuilder>()
  readonly #arpeggios: MarkedArpeggio[] = []
  /**
   * Where each event of the measure begins, whatever voice it is in, the
   * staff it was placed on, and whether it is a grace note. An event states
   * no staff where the part has only one, and where a multi-staff part leaves
   * it off, which MusicXML reads as the first staff.
   */
  readonly #eventStarts: { start: Fraction; staff: number | undefined; grace: boolean }[] = []
  #cursor: Fraction = fraction(0)
  /** The voice of the most recent event, which a chord member joins. */
  #lastVoice: string | undefined

  /** Where the cursor has reached, from the start of the measure. */
  position(): Fraction {
    return this.#cursor
  }

  /** Moves the cursor, as <backup> and <forward> do. */
  shift(by: Fraction, path: DocumentPath, line: number): void {
    const moved = addFractions(this.#cursor, by)
    if (compareFractions(moved, fraction(0)) < 0) {
      throw new MusicXMLError('A <backup> reaches back before the start of the measure.', {
        path,
        line,
      })
    }
    this.#cursor = moved
  }

  /**
   * Adds a note that stands on its own, at the cursor, and advances past it.
   * A gap since this voice last sounded becomes a space.
   */
  /** Whether this voice is already a rest filling the measure. */
  hasFullMeasure(voice: string | undefined): boolean {
    return this.#builderFor(voice).fullMeasure !== undefined
  }

  addEvent(
    voice: string | undefined,
    event: Event,
    duration: Fraction,
    path: DocumentPath,
    line: number,
    staff?: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (builder.fullMeasure) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    // A known dialect trips this deliberately: closed-score hymnals write two
    // lines in one voice, laid over each other with <backup> and told apart
    // only by stem direction. Converting those would take a documented
    // heuristic splitting the overlapping run into its own sequence, with the
    // corpus checks taught the same reading. Refused until that is decided.
    if (compareFractions(subtractFractions(this.#cursor, builder.end), fraction(0)) < 0) {
      throw new MusicXMLError('A <note> overlaps the one before it in the same voice.', {
        path,
        line,
      })
    }
    this.#fillGap(builder)

    innermost(builder).push(event)
    builder.placed.push({ event, staff })
    this.#lastVoice = voice ?? UNNAMED_VOICE
    builder.lastEvent = event
    builder.lastDuration = duration
    builder.lastStart = this.#cursor
    this.#eventStarts.push({ start: this.#cursor, staff, grace: false })
    builder.openTremolo?.durations.push(duration)
    builder.end = addFractions(this.#cursor, duration)
    this.#cursor = builder.end
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
      // Inside a tuplet everything is written in values the ratio scales, so
      // a gap there is stated in written units: a skipped triplet eighth is
      // written as an eighth even though it lasts a twelfth of a whole note.
      const factor = builder.openTuplets
        .map((open) => open.ratio)
        .reduce(multiplyFractions, fraction(1))
      innermost(builder).push({
        kind: 'space',
        duration: divideFractions(gap, factor),
      })
      builder.end = this.#cursor
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
  lastEventBefore(position: Fraction, staff?: number): CoveredEvent | undefined {
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
   * Whether the event just read is a grace note standing where the cursor is.
   * A hairpin's stop written after grace notes is drawn over them, and MNX
   * reads the place they share as before all of them unless a grace index
   * says otherwise. Read in document order, unlike an octave shift's end,
   * because the answer is which side of the grace notes the stop was written.
   *
   * A staff narrows it to that staff's own events, as an octave shift's end
   * does, so grace notes under the other hand do not answer for this one.
   */
  endsOnGraceNote(staff?: number): boolean {
    for (let index = this.#eventStarts.length - 1; index >= 0; index -= 1) {
      const event = this.#eventStarts[index]
      /* v8 ignore next -- the index walks the array's own length. */
      if (!event) continue
      if (staff !== undefined && (event.staff ?? 1) !== staff) continue
      return event.grace && compareFractions(event.start, this.#cursor) === 0
    }
    return false
  }

  /** The staff the event a chord note would join was placed on. */
  staffOfChord(voice: string | undefined): number | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).placed.at(-1)?.staff
  }

  /**
   * Where the event just added to a voice begins. An event's notations are
   * read once the cursor has moved past it, and a slur written there belongs
   * at the event's own place in the measure.
   */
  lastEventStart(voice: string | undefined): Fraction | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).lastStart
  }

  /** The written value of the event a chord note would join. */
  chordValue(voice: string | undefined): NoteValue | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).lastEvent?.value
  }

  /** How long the event a chord note would join lasts. */
  chordDuration(voice: string | undefined): Fraction | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).lastDuration
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
  ): void {
    const builder = this.#builderFor(voice ?? this.#lastVoice)
    const previous = builder.lastEvent
    if (!previous) {
      throw new MusicXMLError('A <note> is marked as a chord with no note for it to join.', {
        path,
        line,
      })
    }

    // Every note of a chord belongs to one event, so they have to agree on
    // how long that event lasts.
    const chordDuration = builder.lastDuration
    if (duration && chordDuration && compareFractions(duration, chordDuration) !== 0) {
      throw new MusicXMLError('A <note> in a chord lasts a different time from the chord.', {
        path,
        line,
      })
    }

    previous.notes = [...previous.notes, note]
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
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (builder.fullMeasure) {
      throw new MusicXMLError('A voice has more than one rest that fills the measure.', {
        path,
        line,
      })
    }
    if (builder.content.length > 0) {
      throw new MusicXMLError('A voice has both a rest that fills the measure and notes in it.', {
        path,
        line,
      })
    }

    // The rest is the whole of this voice in this measure, so the staff it
    // names is the staff the sequence sits on.
    builder.placed.push({ event: undefined, staff })
    builder.fullMeasure = rest
    // The rest occupies the whole voice, so nothing may follow it there.
    if (covering) builder.end = addFractions(this.#cursor, covering)
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
  ): void {
    const builder = this.#builderFor(voice)
    // A tremolo holds exactly its two notes, so no bracket may open inside
    // one.
    if (builder.openTremolo) {
      throw new MusicXMLError('A tuplet starts inside a two-note tremolo.', { path, line })
    }

    const levels = tupletLevels(
      builder.openTuplets.map((open) => open.ratio),
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
    for (const level of levels) {
      const { display } = level
      const content: SequenceItem[] = []
      const tuplet: Tuplet = {
        kind: 'tuplet',
        inner: level.inner,
        outer: level.outer,
        content,
        ...(display.bracket !== undefined ? { bracket: display.bracket } : {}),
        ...(display.showNumber !== undefined ? { showNumber: display.showNumber } : {}),
        ...(display.showValue !== undefined ? { showValue: display.showValue } : {}),
        ...(display.orient !== undefined ? { orient: display.orient } : {}),
      }

      innermost(builder).push(tuplet)
      builder.open.push({ list: content, opened: 'tuplet' })
      builder.openTuplets.push({
        tuplet,
        ratio: ratioOf(level.inner, level.outer),
        number: level.number,
      })
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
    const factor = builder.openTuplets
      .map((open) => open.ratio)
      .reduce(multiplyFractions, fraction(1))
    return builder.openTremolo ? multiplyFractions(factor, fraction(1, 2)) : factor
  }

  /**
   * Starts a two-note tremolo in this voice. The notes added while it is
   * open are gathered, and join the content as one item when it closes.
   */
  openTremolo(voice: string | undefined, marks: number, path: DocumentPath, line: number): void {
    const builder = this.#builderFor(voice)
    if (builder.openTremolo) {
      throw new MusicXMLError('A tremolo starts inside another tremolo.', { path, line })
    }

    // Time this voice has passed over in silence belongs before the tremolo.
    this.#fillGap(builder)
    builder.open.push({ list: [], opened: 'tremolo' })
    builder.openTremolo = { marks, durations: [] }
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
    const pending = builder.openTremolo
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
    const frame = builder.open.pop()
    builder.openTremolo = undefined
    /* v8 ignore next 2 -- the frame is pushed when the tremolo opens, so it
       is always there to pop. */
    if (!frame) throw new Error('A tremolo closed with no content gathered for it.')

    const content = frame.list
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
    const factor = builder.openTuplets
      .map((open) => open.ratio)
      .reduce(multiplyFractions, fraction(1))
    const unit = noteValueOf(divideFractions(first, factor))
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
    inGraceGroup = false,
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
    voice: string | undefined,
    number: string,
    struck: boolean,
    direction: 'up' | 'down' | undefined,
    arrow: boolean,
  ): void {
    const builder = this.#builderFor(voice ?? this.#lastVoice)
    const event = builder.lastEvent
    const position = builder.lastStart
    /* v8 ignore next 2 -- a note joins its voice before its notations are
       read, so there is always an event here to mark. */
    if (!event || !position) throw new Error('A chord is marked as rolled with no chord to roll.')

    // Every note of a chord carries the mark, so the first one to arrive sets
    // it up and the rest join what it already covers.
    const existing = this.#arpeggios.find(
      (found) => found.event === event && found.number === number,
    )
    if (existing) {
      existing.direction ??= direction
      existing.arrow ||= arrow
      // Rolled and struck together are opposite instructions.
      existing.conflicted ||= existing.struck !== struck
      return
    }

    this.#arpeggios.push({ event, position, number, struck, conflicted: false, direction, arrow })
  }

  /**
   * The rolled and struck chords of the measure.
   *
   * Marks sounding at the same point under the same number are one roll,
   * across however many chords carry them, so they are gathered before the
   * span is worked out. The span names the first-played note first, which for
   * a roll going downwards is the highest.
   */
  arpeggios(warnings: WarningCollector, context: WarningContext): Arpeggio[] {
    const groups = new Map<string, MarkedArpeggio[]>()
    for (const marked of this.#arpeggios) {
      const key = `${String(marked.position.num)}/${String(marked.position.den)}|${marked.number}`
      groups.set(key, [...(groups.get(key) ?? []), marked])
    }

    const arpeggios: Arpeggio[] = []
    for (const marked of groups.values()) {
      const first = marked[0]
      /* v8 ignore next -- a group exists because something was put in it. */
      if (!first) continue

      const notes = marked.flatMap((one) => one.event.notes)
      if (notes.length === 0) {
        // A rest cannot be rolled, and the mark spans nothing.
        warnings.add(
          'unsupported:element',
          'A rest is marked as rolled, and a roll runs between notes, so it is not ' +
            'carried over.',
          context,
          'arpeggiate',
        )
        continue
      }

      // A struck bracket runs between its bottom and top ends, each written
      // on its own note. A lone marker with one note under it is half a
      // bracket: written out, it would span the note to itself.
      if (first.struck && notes.length === 1) {
        warnings.add(
          'unclosed:spanner',
          'A bracket marking notes as struck together has only one note under it, ' +
            'and is not carried over.',
          context,
          'non-arpeggiate',
        )
        continue
      }

      if (marked.some((one) => one.conflicted || one.struck !== first.struck)) {
        warnings.add(
          'unrepresentable:arpeggio',
          'A chord is marked both as rolled and as struck together, which are opposite ' +
            'instructions. The first is the one converted.',
          context,
          'arpeggiate',
        )
      }

      const ordered = [...notes].sort((a, b) => staffOrder(a.pitch) - staffOrder(b.pitch))
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
  beamedEvents(): BeamedEvent[][] {
    const builders = [...this.#voices.values()]
    return [...builders.map((b) => b.beamed), ...builders.flatMap((b) => b.graceBeamed)]
  }

  /** Whether this voice is currently inside a tuplet. */
  insideTuplet(voice: string | undefined): boolean {
    return this.#builderFor(voice).open.length > 1
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
  ): string {
    const builder = this.#builderFor(voice)
    if (builder.open.length < 2) {
      throw new MusicXMLError('A tuplet is closed where no tuplet is open.', { path, line })
    }
    // A tremolo edge and a tuplet edge can land on different notes. Popping
    // the tremolo's frame here would lose the notes it holds, so a bracket
    // closing across an open tremolo refuses instead.
    if (builder.open.at(-1)?.opened === 'tremolo') {
      throw new MusicXMLError('A tuplet closes inside a two-note tremolo.', { path, line })
    }
    builder.open.pop()
    const closed = builder.openTuplets.pop()
    /* v8 ignore next 2 -- a tuplet and its ratio are pushed together, so the
       stacks cannot disagree. */
    if (!closed) throw new Error('A tuplet closed with no ratio recorded for it.')

    // Real scores contain brackets whose content does not add up to the
    // stated ratio: a lone quarter under a 3:2 eighth ratio, standing for a
    // triplet quarter. The content is converted as written, and the
    // disagreement is reported, because a consumer cannot tell how much time
    // such a tuplet means to take.
    const { tuplet } = closed
    const statedLength = multiplyFractions(
      fraction(tuplet.inner.multiple),
      lengthOf(tuplet.inner.value),
    )
    const held = writtenLengthOf(tuplet.content)
    const compared = compareFractions(held, statedLength)
    if (compared !== 0) {
      warnings.add(
        'inconsistent:tuplet',
        `A tuplet's written content ${compared < 0 ? 'falls short of' : 'overruns'} its ` +
          'stated ratio. The content is converted as written.',
        { ...context, line },
        'tuplet',
      )
    }

    return closed.number
  }

  /**
   * Adds a grace note, which takes none of the measure's time. Consecutive
   * grace notes gather into one group, as they are played and drawn.
   */
  addGraceNote(voice: string | undefined, event: Event, slashed: boolean, staff?: number): void {
    const builder = this.#builderFor(voice)
    // A grace note is squeezed in before the note it ornaments, so time the
    // voice has passed over in silence is passed over before the group rather
    // than after it. Filling the gap here keeps the group beside its note
    // instead of stranding it at the point the voice last sounded.
    this.#fillGap(builder)

    const list = innermost(builder)
    const previous = list.at(-1)

    builder.lastEvent = event
    this.#lastVoice = voice ?? UNNAMED_VOICE
    // Grace notes have no duration of their own, so a chord note joining one
    // has nothing to agree with.
    builder.lastDuration = undefined
    builder.lastStart = this.#cursor
    this.#eventStarts.push({ start: this.#cursor, staff, grace: true })
    // Recorded like any other event, so the voice's staff counts it and a
    // grace note reaching across to the other staff says so.
    builder.placed.push({ event, staff })

    if (previous?.kind === 'grace') {
      previous.content = [...previous.content, event]
      if (slashed) previous.slashed = true
      return
    }

    const group: GraceGroup = { kind: 'grace', content: [event], slashed }
    list.push(group)
    // Each group beams within itself, so each starts a run of its own.
    builder.graceBeamed.push([])
  }

  /** Reports any tuplet or tremolo the measure opened and never closed. */
  checkAllClosed(path: DocumentPath, line: number): void {
    for (const builder of this.#voices.values()) {
      if (builder.openTremolo) {
        throw new MusicXMLError('A tremolo is opened and never closed.', { path, line })
      }
      if (builder.open.length > 1) {
        throw new MusicXMLError('A tuplet is opened and never closed.', { path, line })
      }
    }
  }

  /**
   * The sequences, in the order their voices first appeared.
   *
   * A voice belongs to the staff it spends most of its time on, and only the
   * events that reach across to another say so. Choosing the commonest that
   * way keeps the overrides to the notes that genuinely cross.
   */
  sequences(warnings: WarningCollector, context: WarningContext): Sequence[] {
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

    return [...this.#voices].map(([voice, builder]) => {
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
        voice: voice === UNNAMED_VOICE ? undefined : voice,
        content: builder.content,
        fullMeasure: builder.fullMeasure,
      }
    })
  }

  #builderFor(voice: string | undefined): VoiceBuilder {
    const key = voice ?? UNNAMED_VOICE
    const existing = this.#voices.get(key)
    if (existing) return existing

    const content: SequenceItem[] = []
    const created: VoiceBuilder = {
      beamed: [],
      graceBeamed: [],
      placed: [],
      open: [{ list: content, opened: 'voice' }],
      openTuplets: [],
      openTremolo: undefined,
      content,
      end: fraction(0),
      lastEvent: undefined,
      lastDuration: undefined,
      lastStart: undefined,
      fullMeasure: undefined,
    }
    this.#voices.set(key, created)
    return created
  }
}
