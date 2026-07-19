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
import { addFractions, compareFractions, fraction, subtractFractions } from '../fraction.js'
import type { Fraction } from '../fraction.js'
import type { BeamedEvent } from './beams.js'
import type {
  Event,
  FullMeasureRest,
  GraceGroup,
  Note,
  NoteValueQuantity,
  Sequence,
  SequenceItem,
  Tuplet,
} from '../model/score.js'

/** The name a voice goes under when the source does not give it one. */
const UNNAMED_VOICE = ''

interface VoiceBuilder {
  /** What each event said about its beams, in the order they were read. */
  beamed: BeamedEvent[]
  /** Which staff each event named, paired with the event that named it. */
  placed: { event: Event; staff: number | undefined }[]
  /**
   * The item lists currently being filled, outermost first. A tuplet or a
   * grace group opens a new one, so notes land inside it until it closes.
   */
  open: SequenceItem[][]
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
  fullMeasure: FullMeasureRest | undefined
}

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

/** The list a note added now would land in: the innermost one still open. */
function innermost(builder: VoiceBuilder): SequenceItem[] {
  const list = builder.open.at(-1)
  /* v8 ignore next -- the root list is never popped, so one is always open. */
  if (!list) throw new Error('A voice has no open content list.')
  return list
}

/**
 * Collects a measure's notes into per-voice sequences while following
 * MusicXML's cursor. Callers push what they read in document order.
 */
export class MeasureBuilder {
  readonly #voices = new Map<string, VoiceBuilder>()
  #cursor: Fraction = fraction(0)
  /** The voice of the most recent event, which a chord member joins. */
  #lastVoice: string | undefined

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

    const gap = subtractFractions(this.#cursor, builder.end)

    if (compareFractions(gap, fraction(0)) < 0) {
      throw new MusicXMLError('A <note> overlaps the one before it in the same voice.', {
        path,
        line,
      })
    }
    if (compareFractions(gap, fraction(0)) > 0) {
      innermost(builder).push({ kind: 'space', duration: gap })
    }

    innermost(builder).push(event)
    builder.placed.push({ event, staff })
    this.#lastVoice = voice ?? UNNAMED_VOICE
    builder.lastEvent = event
    builder.lastDuration = duration
    builder.end = addFractions(this.#cursor, duration)
    this.#cursor = builder.end
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
    path: DocumentPath,
    line: number,
  ): void {
    const builder = this.#builderFor(voice)
    if (builder.fullMeasure || builder.content.length > 0) {
      throw new MusicXMLError('A voice has more than one rest that fills the measure.', {
        path,
        line,
      })
    }

    builder.fullMeasure = rest
    // The rest occupies the whole voice, so nothing may follow it there.
    if (covering) builder.end = addFractions(this.#cursor, covering)
  }

  /**
   * Starts a tuplet in this voice. Notes added after it go inside, until it
   * is closed.
   */
  openTuplet(voice: string | undefined, inner: NoteValueQuantity, outer: NoteValueQuantity): void {
    const builder = this.#builderFor(voice)
    const content: SequenceItem[] = []
    const tuplet: Tuplet = { kind: 'tuplet', inner, outer, content }

    innermost(builder).push(tuplet)
    builder.open.push(content)
  }

  /** Records what an event said about the beams it carries. */
  addBeamMarkers(
    voice: string | undefined,
    id: string,
    markers: ReadonlyMap<number, string>,
  ): void {
    if (markers.size > 0) this.#builderFor(voice).beamed.push({ id, markers })
  }

  /** What every voice said about its beams, voice by voice. */
  beamedEvents(): BeamedEvent[][] {
    return [...this.#voices.values()].map((builder) => builder.beamed)
  }

  /** Whether this voice is currently inside a tuplet. */
  insideTuplet(voice: string | undefined): boolean {
    return this.#builderFor(voice).open.length > 1
  }

  closeTuplet(voice: string | undefined, path: DocumentPath, line: number): void {
    const builder = this.#builderFor(voice)
    if (builder.open.length < 2) {
      throw new MusicXMLError('A tuplet is closed where no tuplet is open.', { path, line })
    }
    builder.open.pop()
  }

  /**
   * Adds a grace note, which takes none of the measure's time. Consecutive
   * grace notes gather into one group, as they are played and drawn.
   */
  addGraceNote(voice: string | undefined, event: Event, slashed: boolean): void {
    const builder = this.#builderFor(voice)
    const list = innermost(builder)
    const previous = list.at(-1)

    builder.lastEvent = event
    this.#lastVoice = voice ?? UNNAMED_VOICE
    // Grace notes have no duration of their own, so a chord note joining one
    // has nothing to agree with.
    builder.lastDuration = undefined

    if (previous?.kind === 'grace') {
      previous.content = [...previous.content, event]
      if (slashed) previous.slashed = true
      return
    }

    const group: GraceGroup = { kind: 'grace', content: [event], slashed }
    list.push(group)
  }

  /** Reports any tuplet the measure opened and never closed. */
  checkAllClosed(path: DocumentPath, line: number): void {
    for (const builder of this.#voices.values()) {
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
  sequences(): Sequence[] {
    return [...this.#voices].map(([voice, builder]) => {
      const staff = commonestStaff(builder.placed.map((placed) => placed.staff))

      // Only the events that reach across to another staff say so.
      for (const placed of builder.placed) {
        if (placed.staff !== undefined && placed.staff !== staff) {
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
      placed: [],
      open: [content],
      content,
      end: fraction(0),
      lastEvent: undefined,
      lastDuration: undefined,
      fullMeasure: undefined,
    }
    this.#voices.set(key, created)
    return created
  }
}
