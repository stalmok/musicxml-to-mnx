// The neutral score model: what the reader understood, in the shape the
// writer needs. It exists so that MusicXML's encoding decisions stop at the
// reader and MNX's start at the writer.
//
// Internal by design: it is not exported from the package, and it is scoped
// to conversion. It is not a general notation model, and should not grow into
// one.

import type { Fraction } from '../fraction.js'

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type NoteValueBase =
  | 'maxima'
  | 'longa'
  | 'breve'
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | '16th'
  | '32nd'
  | '64th'
  | '128th'
  | '256th'
  | '512th'
  | '1024th'

export type ClefSign = 'C' | 'F' | 'G'

export interface Pitch {
  step: Step
  octave: number
  /** Semitone alteration; 0 for an unaltered pitch. */
  alter: number
}

export interface NoteValue {
  base: NoteValueBase
  dots: number
}

/** Which way a curve bends away from the notes it joins. */
export type CurveSide = 'up' | 'down'

/**
 * A tie joining this note to a later one of the same pitch. Stated once, on
 * the note where it begins, as a reference to the note where it ends.
 */
export interface Tie {
  target: string
}

/** A slur joining this event to a later one. */
export interface Slur {
  target: string
  side: CurveSide | undefined
}

export interface Note {
  /** Unique in the document. Written out only where something refers to it. */
  id: string
  pitch: Pitch
  ties: readonly Tie[]
}

export interface Event {
  kind: 'event'
  /** Unique in the document. Written out only where something refers to it. */
  id: string
  value: NoteValue
  slurs: readonly Slur[]
  /** Empty for a rest. More than one note makes it a chord. */
  notes: readonly Note[]
  isRest: boolean
}

/**
 * Time a voice passes over without sounding. MusicXML leaves such a gap
 * implicit, by moving its cursor; MNX has to state it, because a sequence
 * runs without interruption from wherever it starts.
 */
export interface Space {
  kind: 'space'
  duration: Fraction
}

/** A count of note values, as in "three eighths". */
export interface NoteValueQuantity {
  value: NoteValue
  multiple: number
}

/**
 * Notes played in the time of a different number of them. The events inside
 * keep the values they are written with; the ratio says how much time they
 * actually occupy.
 */
export interface Tuplet {
  kind: 'tuplet'
  /** What is played, for example three eighths. */
  inner: NoteValueQuantity
  /** The space they are played in, for example two eighths. */
  outer: NoteValueQuantity
  content: readonly SequenceItem[]
}

/** Notes squeezed in before the beat, taking none of the measure's time. */
export interface GraceGroup {
  kind: 'grace'
  content: readonly Event[]
  /** True when the group is drawn with a slash through it. */
  slashed: boolean
}

export type SequenceItem = Event | Space | Tuplet | GraceGroup

/**
 * A rest that fills its measure, whatever the time signature says that is.
 * It is a property of the sequence rather than an event in it, because that
 * is how MNX states it: the sequence holds no events at all.
 */
export interface FullMeasureRest {
  /** The value actually drawn, when the source says which one. */
  visualDuration: NoteValue | undefined
}

export interface Sequence {
  /** The voice as the source named it, when a measure holds more than one. */
  voice: string | undefined
  content: readonly SequenceItem[]
  fullMeasure: FullMeasureRest | undefined
}

export interface Clef {
  sign: ClefSign
  /** Staff steps from the middle line; negative is below it. */
  staffPosition: number
}

export interface Measure {
  clefs: readonly Clef[]
  sequences: readonly Sequence[]
}

export interface Part {
  id: string
  name: string | undefined
  measures: readonly Measure[]
}

export interface Key {
  fifths: number
}

/**
 * A time signature's lower number names a note value, so only a power of two
 * can appear there. Narrow on purpose: it makes validating it the reader's
 * job, and lets the writer emit it without a cast.
 */
export type TimeUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface TimeSignature {
  count: number
  unit: TimeUnit
}

/**
 * Attributes that apply to a measure across every part. There is one of these
 * per measure in the score, whether or not it declares anything: this list is
 * the score's measure list, and each part's measures line up with it by
 * position.
 */
export interface GlobalMeasure {
  key: Key | undefined
  time: TimeSignature | undefined
  /** Only when the score numbers the measure differently from its position. */
  number: number | undefined
}

export interface Score {
  globalMeasures: readonly GlobalMeasure[]
  parts: readonly Part[]
}
