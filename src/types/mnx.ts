// The MNX wire format, as far as this converter emits it. Hand-written
// against the vendored schema (schema/mnx-schema.json, pinned to a specific
// w3c/mnx commit). That file, not this one, is the authority, and the test
// suite validates every emitted document against it.
//
// Only what we currently produce is modelled here; the format is much larger.
//
// Every name is MNX-prefixed, including the plain ones. These are exported
// wholesale from the package, and `Step`, `ClefSign` and `NoteValueBase` are
// names any notation program is likely to want for itself; taking them in a
// consumer's namespace to describe our wire format would be rude.

export type MNXNoteValueBase =
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

export type MNXStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

export type MNXClefSign = 'C' | 'F' | 'G'

/** The denominator of a time signature: a power of two up to 128. */
export type MNXTimeSignatureUnit = 1 | 2 | 4 | 8 | 16 | 32 | 64 | 128

export interface MNXPitch {
  step: MNXStep
  octave: number
  alter?: number
}

/** Which way a curve bends away from the notes it joins. */
export type MNXCurveSide = 'up' | 'down'

/** How a syllable joins the word it is part of. */
export type MNXLyricLineType = 'start' | 'middle' | 'end' | 'whole'

export interface MNXLyricLine {
  text: string
  type?: MNXLyricLineType
}

/** The lyric under an event, its verses keyed by line. */
export interface MNXLyrics {
  lines: Record<string, MNXLyricLine>
}

export interface MNXTie {
  target: string
}

export interface MNXSlur {
  target: string
  side?: MNXCurveSide
}

export type MNXAccidentalEnclosureSymbol = 'parentheses' | 'brackets'

export interface MNXAccidentalDisplay {
  show: boolean
  enclosure?: { symbol: MNXAccidentalEnclosureSymbol }
}

export interface MNXNote {
  /** Present only where something refers to this note. */
  id?: string
  pitch: MNXPitch
  ties?: MNXTie[]
  accidentalDisplay?: MNXAccidentalDisplay
}

export interface MNXNoteValue {
  base: MNXNoteValueBase
  dots?: number
}

export interface MNXEvent {
  /** Present only where something refers to this event. */
  id?: string
  /** Present only where this event sits on a staff other than its voice's. */
  staff?: number
  duration: MNXNoteValue
  slurs?: MNXSlur[]
  lyrics?: MNXLyrics
  stemDirection?: 'up' | 'down'
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
  /** The staff this voice sits on, where the part has more than one. */
  staff?: number
  content: MNXSequenceItem[]
  /** Present when the sequence is a rest filling the whole measure. */
  fullMeasure?: MNXFullMeasureRest
}

export interface MNXClef {
  sign: MNXClefSign
  /** Staff steps from the middle line; negative is below it. */
  staffPosition: number
}

export interface MNXPositionedClef {
  clef: MNXClef
  /** Which staff of the part, where it has more than one. */
  staff?: number
}

/** Which way a hook points away from its note. */
export type MNXBeamHookDirection = 'left' | 'right' | 'auto'

export interface MNXBeam {
  events: string[]
  /** The secondary beams under this one. */
  beams?: MNXBeam[]
  /** Present on a beam of one event, which is a hook. */
  direction?: MNXBeamHookDirection
}

export type MNXDynamicValue = 'ppp' | 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff' | 'fff' | 'n'

export interface MNXRhythmicPosition {
  fraction: [number, number]
}

export interface MNXDynamic {
  position: MNXRhythmicPosition
  type: 'immediate' | 'gradual' | 'relative' | 'accent'
  value?: MNXDynamicValue
  /** Which staff of the part it sits under, where it has more than one. */
  staff?: number
}

export interface MNXPartMeasure {
  clefs?: MNXPositionedClef[]
  beams?: MNXBeam[]
  dynamics?: MNXDynamic[]
  sequences: MNXSequence[]
}

export interface MNXPart {
  name?: string
  /** How many staves the part is written on. Absent means one. */
  staves?: number
  measures: MNXPartMeasure[]
}

export interface MNXKey {
  fifths: number
}

export interface MNXTime {
  count: number
  unit: MNXTimeSignatureUnit
}

export interface MNXTempo {
  value: MNXNoteValue
  bpm: number
  location?: MNXRhythmicPosition
}

export interface MNXGlobalMeasure {
  /** Stated only where it differs from the measure's position in the score. */
  number?: number
  key?: MNXKey
  time?: MNXTime
  tempos?: MNXTempo[]
}

export interface MNXGlobal {
  measures: MNXGlobalMeasure[]
}

export interface MNXSupport {
  useAccidentalDisplay?: boolean
  useBeams?: boolean
}

export interface MNXDocument {
  mnx: { version: number; support?: MNXSupport }
  global: MNXGlobal
  parts: MNXPart[]
}
