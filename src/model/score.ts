// The neutral score model: what the reader understood, in the shape the
// writer needs. It exists so that MusicXML's encoding decisions stop at the
// reader and MNX's start at the writer.
//
// Internal by design: it is not exported from the package, and it is scoped
// to conversion. It is not a general notation model, and should not grow into
// one.

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

export interface Note {
  pitch: Pitch
}

export interface Event {
  value: NoteValue
  /** Empty for a rest. */
  notes: readonly Note[]
  isRest: boolean
}

export interface Sequence {
  events: readonly Event[]
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
