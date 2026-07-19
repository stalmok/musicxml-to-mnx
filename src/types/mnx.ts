// The MNX wire format, as far as this converter emits it. Hand-written
// against the vendored schema (schema/mnx-schema.json, pinned to a specific
// w3c/mnx commit). That file, not this one, is the authority, and the test
// suite validates every emitted document against it.
//
// Only what we currently produce is modelled here; the format is much larger.

export type NoteValueBase =
  | 'duplexMaxima'
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
  | '2048th'
  | '4096th'

export type Step = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type ClefSign = 'C' | 'F' | 'G'

/** The denominator of a time signature: a power of two up to 128. */
export type TimeSignatureUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface MNXPitch {
  step: Step
  octave: number
  alter?: number
}

/** Which way a curve bends away from the notes it joins. */
export type MNXCurveSide = 'up' | 'down'

export interface MNXTie {
  target: string
}

export interface MNXSlur {
  target: string
  side?: MNXCurveSide
}

export interface MNXNote {
  /** Present only where something refers to this note. */
  id?: string
  pitch: MNXPitch
  ties?: MNXTie[]
}

export interface MNXNoteValue {
  base: NoteValueBase
  dots?: number
}

export interface MNXEvent {
  /** Present only where something refers to this event. */
  id?: string
  duration: MNXNoteValue
  slurs?: MNXSlur[]
  notes?: MNXNote[]
  /** Present, and empty, when the event is a rest. */
  rest?: Record<string, never>
}

export interface MNXFullMeasureRest {
  visualDuration?: MNXNoteValue
}

/** Time a voice passes over without sounding. */
export interface MNXSpace {
  type: 'space'
  /** A [numerator, denominator] pair, as a fraction of a whole note. */
  duration: [number, number]
}

/** A count of note values, as in "three eighths". */
export interface MNXNoteValueQuantity {
  duration: MNXNoteValue
  multiple: number
}

/** Notes played in the time of a different number of them. */
export interface MNXTuplet {
  type: 'tuplet'
  /** What is played. */
  inner: MNXNoteValueQuantity
  /** The space it is played in. */
  outer: MNXNoteValueQuantity
  content: MNXSequenceItem[]
}

/** Notes squeezed in before the beat, taking none of the measure's time. */
export interface MNXGraceGroup {
  type: 'grace'
  content: MNXEvent[]
  slash?: boolean
}

export type MNXSequenceItem = MNXEvent | MNXSpace | MNXTuplet | MNXGraceGroup

export interface MNXSequence {
  /** The voice this sequence belongs to, where a measure holds more than one. */
  voice?: string
  content: MNXSequenceItem[]
  /** Present when the sequence is a rest filling the whole measure. */
  fullMeasure?: MNXFullMeasureRest
}

export interface MNXClef {
  sign: ClefSign
  /** Staff steps from the middle line; negative is below it. */
  staffPosition: number
}

export interface MNXPositionedClef {
  clef: MNXClef
}

export interface MNXPartMeasure {
  clefs?: MNXPositionedClef[]
  sequences: MNXSequence[]
}

export interface MNXPart {
  name?: string
  measures: MNXPartMeasure[]
}

export interface MNXKey {
  fifths: number
}

export interface MNXTime {
  count: number
  unit: TimeSignatureUnit
}

export interface MNXGlobalMeasure {
  /** Stated only where it differs from the measure's position in the score. */
  number?: number
  key?: MNXKey
  time?: MNXTime
}

export interface MNXGlobal {
  measures: MNXGlobalMeasure[]
}

export interface MNXDocument {
  mnx: { version: number }
  global: MNXGlobal
  parts: MNXPart[]
}
