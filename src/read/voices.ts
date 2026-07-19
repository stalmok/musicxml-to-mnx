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
import type { Event, FullMeasureRest, Note, Sequence, SequenceItem } from '../model/score.js'

/** The name a voice goes under when the source does not give it one. */
const UNNAMED_VOICE = ''

interface VoiceBuilder {
  content: SequenceItem[]
  /** Where this voice's content runs out, measured from the measure start. */
  end: Fraction
  /** How long the most recent event lasts, for chord notes to agree with. */
  lastDuration: Fraction | undefined
  fullMeasure: FullMeasureRest | undefined
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
      builder.content.push({ kind: 'space', duration: gap })
    }

    builder.content.push(event)
    this.#lastVoice = voice ?? UNNAMED_VOICE
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
    const previous = builder.content.at(-1)
    if (previous?.kind !== 'event') {
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

  /** The sequences, in the order their voices first appeared. */
  sequences(): Sequence[] {
    return [...this.#voices].map(([voice, builder]) => ({
      // Whenever the source named the voice. MNX treats the name as a label
      // for the line across the whole score, so deciding it per measure would
      // give one musical line a different identity from bar to bar.
      voice: voice === UNNAMED_VOICE ? undefined : voice,
      content: builder.content,
      fullMeasure: builder.fullMeasure,
    }))
  }

  #builderFor(voice: string | undefined): VoiceBuilder {
    const key = voice ?? UNNAMED_VOICE
    const existing = this.#voices.get(key)
    if (existing) return existing

    const created: VoiceBuilder = {
      content: [],
      end: fraction(0),
      lastDuration: undefined,
      fullMeasure: undefined,
    }
    this.#voices.set(key, created)
    return created
  }
}
