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
import type { WarningCollector, WarningContext } from '../warnings.js'
import type { BeamedEvent } from './beams.js'
import type {
  Arpeggio,
  Event,
  FullMeasureRest,
  GraceGroup,
  Note,
  NoteValueQuantity,
  Pitch,
  Sequence,
  SequenceItem,
  Tuplet,
} from '../model/score.js'

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
  readonly #arpeggios: MarkedArpeggio[] = []
  /** Where each event of the measure begins, whatever voice it is in. */
  readonly #eventStarts: Fraction[] = []
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
    this.#eventStarts.push(this.#cursor)
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
      innermost(builder).push({ kind: 'space', duration: gap })
      builder.end = this.#cursor
    }
  }

  /**
   * Where the last event before this point begins. MNX states the end of an
   * octave shift as the place of the last event it covers, while MusicXML
   * writes the stop after that event, so the cursor has already moved past
   * it by the time the stop is read.
   */
  lastEventBefore(position: Fraction): Fraction | undefined {
    let latest: Fraction | undefined
    for (const start of this.#eventStarts) {
      if (compareFractions(start, position) >= 0) continue
      if (!latest || compareFractions(start, latest) > 0) latest = start
    }
    return latest
  }

  /** The staff the event a chord note would join was placed on. */
  staffOfChord(voice: string | undefined): number | undefined {
    return this.#builderFor(voice ?? this.#lastVoice).placed.at(-1)?.staff
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
    inGraceGroup = false,
  ): void {
    if (markers.size === 0) return
    const builder = this.#builderFor(voice)
    if (!inGraceGroup) {
      builder.beamed.push({ id, markers })
      return
    }
    const run = builder.graceBeamed.at(-1)
    /* v8 ignore next -- a grace note joins its group before its beams are
       read, so a run is always open by the time this is reached. */
    if (!run) throw new Error('A grace note has no group to beam within.')
    run.push({ id, markers })
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
    this.#eventStarts.push(this.#cursor)
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
      open: [content],
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
